import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { isRetryableSendError, SendOutcome, sendFailed, sendSucceeded } from '@/common/utils'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { EvmProviderFactory } from './evmProvider.factory'

type SendETHParams = {
  toAddress: string
  /** Amount in wei. Exact — never derived from a float. */
  amount: bigint
  privateKey: string
  evmNetwork: EvmNetwork
}

type SendERC20TokenParams = {
  toAddress: string
  /** Amount in the token's base units. Exact — never derived from a float. */
  amount: bigint
  privateKey: string
  contractAddress: string
  decimals: number
  evmNetwork: EvmNetwork
  coin: EvmCoin
}

@Injectable()
export class EthTransactionService {
  private readonly logger = new Logger(EthTransactionService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly evmProviderFactory: EvmProviderFactory,
  ) {}

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  private readonly coinContractAddress = (evmNetwork: EvmNetwork, coin: EvmCoin): string =>
    this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!

  /** Cached, with failover/quorum when several RPC endpoints are configured. */
  private readonly provider = (evmNetwork: EvmNetwork): ethers.Provider => this.evmProviderFactory.get(evmNetwork)

  /**
   * Sends ETH to a specified address
   * @param {SendETHParams} params - Parameters for sending ETH
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {bigint} params.amount - The amount of ETH to send, in wei
   * @param {string} params.privateKey - The sender's private key
   * @param {EvmNetwork} params.evmNetwork - The network to send the ETH to
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   * @throws {Error} If there are insufficient funds for transfer and gas
   */
  async sendETH({ toAddress, amount, privateKey, evmNetwork }: SendETHParams): Promise<SendOutcome> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const fromAddress = wallet.address

      // Already in wei — no float conversion on the money path.
      const amountWei = amount

      // get current gas parameters
      const feeData = await provider.getFeeData()
      const { maxFeePerGas, maxPriorityFeePerGas } = feeData

      // estimate gas for ETH transfer (usually 21000)
      const gasLimit = 21000

      // calculate total gas cost
      const totalGasCost = (maxFeePerGas ?? maxPriorityFeePerGas ?? 0n) * BigInt(gasLimit)
      const gasBuffer = (totalGasCost * 25n) / 100n
      const totalGasWithBuffer = totalGasCost + gasBuffer

      // get ETH balance
      const balance = await provider.getBalance(fromAddress)

      // Fail rather than substitute. The caller treats any returned hash as success, so
      // reducing the amount here reported a completed withdrawal for a figure nobody asked
      // for — and went negative outright when balance < totalGasWithBuffer. Returning null
      // instead lets the caller run its gas top-up and retry, which is the intended recovery.
      if (balance < amountWei + totalGasWithBuffer) {
        const message = `Insufficient balance for ${fromAddress} network: ${evmNetwork}: have ${ethers.formatEther(balance)}, need ${ethers.formatEther(amountWei + totalGasWithBuffer)} (amount + gas with 25% buffer)`
        this.logger.error(message)

        // Retryable: this is exactly what the caller's gas top-up exists to fix.
        return sendFailed(message, true)
      }

      this.logger.log(`Sending ${ethers.formatEther(amountWei)} ETH to ${toAddress} network: ${evmNetwork}`)
      this.logger.log(`Fee (with 25% buffer): ${ethers.formatEther(totalGasWithBuffer)} network: ${evmNetwork}`)

      // send transaction
      const txResponse = await wallet.sendTransaction({
        to: toAddress,
        value: amountWei,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: gasLimit,
      })

      // wait for confirmation
      await txResponse.wait()
      this.logger.log(`ETH transfer to ${toAddress} ${ethers.formatEther(amountWei)} ETH complete. Transaction hash: ${txResponse.hash} network: ${evmNetwork}`)

      return sendSucceeded(txResponse.hash)
    } catch (error) {
      const message = (error as Error).message
      this.logger.error(`ETH transfer network: ${evmNetwork} failed: ${message}`)
      return sendFailed(message, isRetryableSendError(message))
    }
  }

  /**
   * Sends ERC20 tokens to a specified address
   * @param {SendERC20TokenParams} params - Parameters for sending ERC20 tokens
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {bigint} params.amount - The amount of tokens to send, in base units
   * @param {string} params.privateKey - The sender's private key
   * @param {EvmNetwork} params.evmNetwork - The network to send the ERC20 token to
   * @param {EvmCoin} params.coin - The coin to send
   * @param {number} params.decimals - The number of decimals of the ERC20 token
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   */
  async sendERC20Token({ toAddress, amount, privateKey, decimals, evmNetwork, coin }: SendERC20TokenParams): Promise<SendOutcome> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const fromAddress = wallet.address

      const contract = new ethers.Contract(this.coinContractAddress(evmNetwork, coin), this.USDT_ABI, wallet)

      // Already in the token's base units — no float requantisation.
      const amountInWei = amount

      const gasLimit = await contract.transfer.estimateGas(toAddress, amountInWei)

      // Get current gas parameters
      const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
      const totalFee = gasPrice * gasLimit

      this.logger.log(`Sending ${ethers.formatUnits(amountInWei, decimals)} USDT to ${toAddress} network: ${evmNetwork}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalFee)} network: ${evmNetwork}`)

      const ethBalance = await provider.getBalance(fromAddress)
      if (ethBalance < totalFee) {
        const message = `Not enough native currency to pay for gas. Address: ${fromAddress}, balance: ${ethBalance}, required: ${ethers.formatEther(totalFee)} network: ${evmNetwork}`
        this.logger.error(message)
        return sendFailed(message, true)
      }

      // Send transaction
      const tx = await contract.transfer(toAddress, amountInWei, {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })
      const receipt = await tx.wait()
      this.logger.log(`Transaction send ERC20 network: ${evmNetwork} to ${toAddress} receipt:`, receipt)

      return sendSucceeded(tx.hash as string)
    } catch (error) {
      const message = (error as Error).message
      this.logger.error(`ERC20 transfer network: ${evmNetwork} failed: ${message}`)
      return sendFailed(message, isRetryableSendError(message))
    }
  }
}
