import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

type SendETHParams = {
  toAddress: string
  amount: number
  privateKey: string
  evmNetwork: EvmNetwork
  nonce?: number
}

type SendERC20TokenParams = {
  toAddress: string
  amount: number
  privateKey: string
  contractAddress: string
  decimals: number
  evmNetwork: EvmNetwork
  coin: EvmCoin
  nonce?: number
}

// type SendAllETHParams = {
//   privateKey: string
//   toAddress: string
//   nonce?: number
// }

// type SendAllUSDTParams = {
//   privateKey: string
//   toAddress: string
//   nonce?: number
// }

@Injectable()
export class EthTransactionService {
  private readonly logger = new Logger(EthTransactionService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  private readonly coinContractAddress = (evmNetwork: EvmNetwork, coin: EvmCoin): string =>
    this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!

  private readonly provider = (evmNetwork: EvmNetwork): ethers.JsonRpcProvider =>
    new ethers.JsonRpcProvider(this.configService.get(`evmNetworks.${evmNetwork}.rpcUrl`, { infer: true }))

  /**
   * Sends ETH to a specified address
   * @param {SendETHParams} params - Parameters for sending ETH
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {number} params.amount - The amount of ETH to send
   * @param {string} params.privateKey - The sender's private key
   * @param {EvmNetwork} params.evmNetwork - The network to send the ETH to
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   * @throws {Error} If there are insufficient funds for transfer and gas
   */
  async sendETH({ toAddress, amount, privateKey, evmNetwork, nonce }: SendETHParams): Promise<string | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const fromAddress = wallet.address

      // convert amount to wei
      const roundedAmount = +Number(amount).toFixed(18) // ensures at most 18 decimals
      let amountWei = ethers.parseEther(roundedAmount.toString())

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

      // check if there are enough funds for transfer and gas (with buffer)
      if (balance < amountWei + totalGasWithBuffer) amountWei = balance - totalGasWithBuffer

      this.logger.log(`Sending ${ethers.formatEther(amountWei)} ETH to ${toAddress} network: ${evmNetwork}`)
      this.logger.log(`Fee (with 25% buffer): ${ethers.formatEther(totalGasWithBuffer)} network: ${evmNetwork}`)

      // send transaction
      const txResponse = await wallet.sendTransaction({
        to: toAddress,
        value: amountWei,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: gasLimit,
        nonce,
      })

      // wait for confirmation
      await txResponse.wait()
      this.logger.log(`ETH transfer to ${toAddress} ${amount} ETH complete. Transaction hash: ${txResponse.hash} network: ${evmNetwork}`)

      return txResponse.hash
    } catch (error) {
      this.logger.error(`ETH transfer network: ${evmNetwork} failed: ${error.message}`)
      return null
    }
  }

  /**
   * Sends ERC20 tokens to a specified address
   * @param {SendERC20TokenParams} params - Parameters for sending ERC20 tokens
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {number} params.amount - The amount of tokens to send
   * @param {string} params.privateKey - The sender's private key
   * @param {EvmNetwork} params.evmNetwork - The network to send the ERC20 token to
   * @param {EvmCoin} params.coin - The coin to send
   * @param {number} params.decimals - The number of decimals of the ERC20 token
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   */
  async sendERC20Token({ toAddress, amount, privateKey, decimals, evmNetwork, coin, nonce }: SendERC20TokenParams): Promise<string | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const fromAddress = wallet.address

      const contract = new ethers.Contract(this.coinContractAddress(evmNetwork, coin), this.USDT_ABI, wallet)

      // Convert amount to wei (assuming decimals)
      const roundedAmount = +Number(amount).toFixed(decimals)
      const amountInWei = ethers.parseUnits(roundedAmount.toString(), decimals)

      const gasLimit = await contract.transfer.estimateGas(toAddress, amountInWei)

      // Get current gas parameters
      const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
      const totalFee = gasPrice * gasLimit

      this.logger.log(`Sending ${ethers.formatUnits(amountInWei, decimals)} USDT to ${toAddress} network: ${evmNetwork}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalFee)} network: ${evmNetwork}`)

      const ethBalance = await provider.getBalance(fromAddress)
      if (ethBalance < totalFee) {
        this.logger.error(`Not enough ETH to pay for gas. Address: ${fromAddress}, ETH balance: ${ethBalance}, required: ${ethers.formatEther(totalFee)} network: ${evmNetwork}`)
        return null
      }

      // Send transaction
      const tx = await contract.transfer(toAddress, amountInWei, {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce,
      })
      const receipt = await tx.wait()
      this.logger.log(`Transaction send ERC20 network: ${evmNetwork} to ${toAddress} receipt:`, receipt)

      return tx.hash
    } catch (error) {
      this.logger.error(`ERC20 transfer network: ${evmNetwork} failed: ${error.message}`)
      return null
    }
  }

  // /**
  //  * Sends all ETH from the sender's wallet to a specified address
  //  * @param {Object} params - The parameters for sending all ETH
  //  * @param {string} params.privateKey - The sender's private key
  //  * @param {string} params.toAddress - The recipient's address
  //  * @returns {Promise<string | null>} The transaction hash, or null if failed
  //  */
  // async sendAllETH({ privateKey, toAddress, evmNetwork }: SendAllETHParams): Promise<string | null> {
  //   try {
  //     const provider = this.provider(evmNetwork)
  //     const wallet = new ethers.Wallet(privateKey, provider)
  //     const fromAddress = wallet.address

  //     // get balance
  //     const balance = await this.provider.getBalance(fromAddress)

  //     // estimate fee
  //     const gasLimit = 21000
  //     const feeData = await this.provider.getFeeData()
  //     const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
  //     const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n

  //     // for EIP-1559
  //     const gasPrice = maxFeePerGas
  //     const totalFee = gasPrice * BigInt(gasLimit)

  //     if (balance <= totalFee) {
  //       this.logger.error(`Not enough ETH to cover gas address: ${toAddress} balance: ${balance} fee: ${totalFee}`)
  //       return null
  //     }

  //     // amount to send = balance - fee
  //     const amountToSend = balance - totalFee

  //     this.logger.log(`Sending ${ethers.formatEther(amountToSend)} ETH to ${toAddress}`)
  //     this.logger.log(`Fee: ${ethers.formatEther(totalFee)}`)

  //     const nonce = await this.provider.getTransactionCount(fromAddress, 'latest')

  //     const tx = await wallet.sendTransaction({
  //       to: toAddress,
  //       value: amountToSend,
  //       gasLimit,
  //       maxFeePerGas: gasPrice,
  //       maxPriorityFeePerGas,
  //       nonce,
  //     })

  //     const receipt = await tx.wait()
  //     this.logger.log(`Transaction send all ETH to ${toAddress} receipt:`, receipt)

  //     return tx.hash
  //   } catch (error) {
  //     this.logger.error(`ETH transfer failed to ${toAddress}: ${error.message}`)
  //     return null
  //   }
  // }

  // /**
  //  * Sends all USDT from the sender's wallet to a specified address
  //  * @param {Object} params - The parameters for sending all USDT
  //  * @param {string} params.privateKey - The sender's private key
  //  * @param {string} params.toAddress - The recipient's address
  //  * @returns {Promise<string | null>} The transaction hash, or null if failed
  //  */
  // async sendAllUSDT({ privateKey, toAddress }: SendAllUSDTParams): Promise<string | null> {
  //   try {
  //     const wallet = new ethers.Wallet(privateKey, this.provider)
  //     const contract = new ethers.Contract(this.usdtContractAddress, this.USDT_ABI, wallet)
  //     const fromAddress = wallet.address

  //     // Get USDT balance
  //     const usdtBalance = (await contract.balanceOf(fromAddress)) as bigint
  //     if (usdtBalance === 0n) {
  //       this.logger.error(`No USDT to send address: ${toAddress} balance: ${usdtBalance}`)
  //       return null
  //     }

  //     // Estimate fee
  //     const gasLimit = await contract.transfer.estimateGas(toAddress, usdtBalance)

  //     // Get current gas parameters
  //     const { maxFeePerGas, maxPriorityFeePerGas } = await this.provider.getFeeData()

  //     const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
  //     const totalFee = gasPrice * gasLimit

  //     // Check if there is enough ETH on the wallet to pay for the fee
  //     const ethBalance = await this.provider.getBalance(fromAddress)
  //     if (ethBalance < totalFee) {
  //       this.logger.error(`Not enough ETH to pay for gas address: ${toAddress} balance: ${ethBalance} fee: ${totalFee}`)
  //       return null
  //     }

  //     this.logger.log(`Sending ${ethers.formatEther(usdtBalance)} USDT to ${toAddress}`)
  //     this.logger.log(`Fee: ${ethers.formatEther(totalFee)}`)

  //     const nonce = await this.provider.getTransactionCount(fromAddress, 'latest')

  //     // Send all USDT
  //     const tx = await contract.transfer(toAddress, usdtBalance, {
  //       gasLimit,
  //       gasPrice,
  //       maxFeePerGas,
  //       maxPriorityFeePerGas,
  //       nonce,
  //     })
  //     const receipt = await tx.wait()
  //     this.logger.log(`Transaction send all USDT to ${toAddress} receipt:`, receipt)

  //     return tx.hash
  //   } catch (error) {
  //     this.logger.error(`USDT transfer failed to ${toAddress}: ${error.message}`)
  //     return null
  //   }
  // }
}
