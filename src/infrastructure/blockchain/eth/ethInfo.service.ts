import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class EthInfoService {
  private readonly logger = new Logger(EthInfoService.name)

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  private readonly ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)']

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private readonly coinContractAddress = (evmNetwork: EvmNetwork, coin: EvmCoin): string =>
    this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!

  private readonly provider = (evmNetwork: EvmNetwork): ethers.JsonRpcProvider =>
    new ethers.JsonRpcProvider(this.configService.get(`evmNetworks.${evmNetwork}.rpcUrl`, { infer: true }))

  // /**
  //  * Get the ETH balance for a given address
  //  * @param address - The Ethereum address to check
  //  * @param providerUrl - The Ethereum node provider URL
  //  * @returns The balance in ETH as a string
  //  */
  // async getETHBalance(address: string, evmNetwork: EvmNetwork): Promise<string> {
  //   try {
  //     const provider = this.provider(evmNetwork)
  //     const balance = await provider.getBalance(address)
  //     return ethers.formatEther(balance)
  //   } catch (error) {
  //     this.logger.error(`Failed to get ETH balance for address ${address}: ${error.message}`)
  //     throw error
  //   }
  // }

  // /**
  //  * Get the ERC20 token balance for a given address
  //  * @param address - The Ethereum address to check
  //  * @param contractAddress - The ERC20 token contract address
  //  * @param providerUrl - The Ethereum node provider URL
  //  * @returns The token balance as a string
  //  */
  // async getERC20Balance(address: string, contractAddress: string, evmNetwork: EvmNetwork): Promise<string> {
  //   try {
  //     const provider = this.provider(evmNetwork)
  //     const contract = new ethers.Contract(contractAddress, this.ERC20_BALANCE_ABI, provider)
  //     const balance = (await contract.balanceOf(address)) as bigint
  //     return ethers.formatUnits(balance.toString(), 6) // For USDT typically 6 decimals
  //   } catch (error) {
  //     this.logger.error(`Failed to get ERC20 balance for address ${address}: ${error.message}`)
  //     throw error
  //   }
  // }

  // /**
  //  * Get the nonce for a given address
  //  * @param address - The Ethereum address to check
  //  * @returns The nonce as a number
  //  */
  // async getNonce(address: string, evmNetwork: EvmNetwork): Promise<number> {
  //   const provider = this.provider(evmNetwork)
  //   return provider.getTransactionCount(address, 'latest')
  // }

  /**
   * Get the USDT gas price in ETH for a given contract, to address, and amount
   * @param privateKey - The private key of the wallet
   * @param toAddress - The address to send the transaction to
   * @param amount - The amount to send
   * @param evmNetwork - EVM network
   * @returns The gas price in ETH as a number
   */
  async getUSDTGasPriceInEth(privateKey: string, toAddress: string, amount: number, evmNetwork: EvmNetwork): Promise<number | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const contract = new ethers.Contract(this.coinContractAddress(evmNetwork, 'USDT'), this.USDT_ABI, wallet)

      const roundedAmount = +Number(amount).toFixed(6)
      const amountInWei = ethers.parseUnits(roundedAmount.toString(), 6)

      const gasLimit = await contract.transfer.estimateGas(toAddress, amountInWei)

      const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
      const totalFee = gasPrice * gasLimit

      const totalFeeEth = ethers.formatEther(totalFee)

      return +totalFeeEth
    } catch (error) {
      this.logger.error(`Failed to get gas price in ETH for address ${toAddress} and amount ${amount}: ${error.message}`)
      return null
    }
  }

  /**
   * Get the gas price in ETH for a native ETH transfer transaction
   * @param privateKey - The private key of the wallet
   * @param toAddress - The address to send ETH to
   * @param amount - The amount of ETH to send (in ETH)
   * @param evmNetwork - The EVM network
   * @returns The gas price in ETH as a number
   */
  async getEthTransferGasPriceInEth(privateKey: string, toAddress: string, amount: number, evmNetwork: EvmNetwork): Promise<number | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const value = ethers.parseEther(amount.toString())

      // Create a transaction object for a simple ETH transfer
      const gasLimit = await wallet.estimateGas({ to: toAddress, value })

      // Get current gas price data
      const { maxFeePerGas, gasPrice } = await provider.getFeeData()

      // For legacy networks, gasPrice is used; for EIP-1559, maxFeePerGas is used
      const usedGasPrice = maxFeePerGas ?? gasPrice ?? 0n
      const totalFee = usedGasPrice * gasLimit
      const totalFeeEth = ethers.formatEther(totalFee)
      return +totalFeeEth
    } catch (error) {
      this.logger.error(`Failed to get ETH transfer gas price for address ${toAddress} and amount ${amount}: ${error.message}`)
      return null
    }
  }
}
