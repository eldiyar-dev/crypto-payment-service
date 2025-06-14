import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class EthInfoService {
  private readonly logger = new Logger(EthInfoService.name)

  private readonly provider: ethers.JsonRpcProvider

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.provider = new ethers.JsonRpcProvider(`${this.configService.get('eth_rpc_url')}`)
  }

  private get usdtContractAddress(): string {
    return this.configService.get('eth_usdt_contract_address')!
  }

  /**
   * Get the ETH balance for a given address
   * @param address - The Ethereum address to check
   * @param providerUrl - The Ethereum node provider URL
   * @returns The balance in ETH as a string
   */
  async getETHBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address)
      return ethers.formatEther(balance)
    } catch (error) {
      this.logger.error(`Failed to get ETH balance for address ${address}: ${error.message}`)
      throw error
    }
  }

  /**
   * Get the ERC20 token balance for a given address
   * @param address - The Ethereum address to check
   * @param contractAddress - The ERC20 token contract address
   * @param providerUrl - The Ethereum node provider URL
   * @returns The token balance as a string
   */
  async getERC20Balance(address: string, contractAddress: string): Promise<string> {
    try {
      const abi = ['function balanceOf(address owner) view returns (uint256)']
      const contract = new ethers.Contract(contractAddress, abi, this.provider)
      const balance = (await contract.balanceOf(address)) as bigint
      return ethers.formatUnits(balance.toString(), 6) // For USDT typically 6 decimals
    } catch (error) {
      this.logger.error(`Failed to get ERC20 balance for address ${address}: ${error.message}`)
      throw error
    }
  }

  /**
   * Get the nonce for a given address
   * @param address - The Ethereum address to check
   * @returns The nonce as a number
   */
  async getNonce(address: string): Promise<number> {
    return this.provider.getTransactionCount(address, 'latest')
  }

  /**
   * Get the gas price in ETH for a given contract, to address, and amount
   * @param privateKey - The private key of the wallet
   * @param toAddress - The address to send the transaction to
   * @param amount - The amount to send
   * @returns The gas price in ETH as a number
   */
  async getGasPriceInEth(privateKey: string, toAddress: string, amount: number): Promise<number> {
    const wallet = new ethers.Wallet(privateKey, this.provider)

    const contract = new ethers.Contract(this.usdtContractAddress, this.USDT_ABI, wallet)

    const amountInWei = ethers.parseUnits(amount.toString(), 6)

    const gasLimit = await contract.transfer.estimateGas(toAddress, amountInWei)

    const { maxFeePerGas, maxPriorityFeePerGas } = await this.provider.getFeeData()

    const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
    const totalFee = gasPrice * gasLimit

    const totalFeeEth = ethers.formatEther(totalFee)

    return +totalFeeEth
  }
}
