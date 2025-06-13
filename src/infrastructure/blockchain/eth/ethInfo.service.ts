import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

@Injectable()
export class EthInfoService {
  private readonly logger = new Logger(EthInfoService.name)

  private readonly provider: ethers.JsonRpcProvider

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.provider = new ethers.JsonRpcProvider(`${this.configService.get('eth_rpc_url')}`)
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
}
