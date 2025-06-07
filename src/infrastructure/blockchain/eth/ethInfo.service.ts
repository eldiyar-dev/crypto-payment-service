import { Injectable, Logger } from '@nestjs/common'
import { ethers } from 'ethers'

@Injectable()
export class EthInfoService {
  private readonly logger = new Logger(EthInfoService.name)

  /**
   * Get the ETH balance for a given address
   * @param address - The Ethereum address to check
   * @param providerUrl - The Ethereum node provider URL
   * @returns The balance in ETH as a string
   */
  async getETHBalance(address: string, providerUrl: string): Promise<string> {
    try {
      const provider = new ethers.JsonRpcProvider(providerUrl)
      const balance = await provider.getBalance(address)
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
  async getERC20Balance(address: string, contractAddress: string, providerUrl: string): Promise<string> {
    try {
      const provider = new ethers.JsonRpcProvider(providerUrl)
      const abi = ['function balanceOf(address owner) view returns (uint256)']
      const contract = new ethers.Contract(contractAddress, abi, provider)
      const balance = await contract.balanceOf(address)
      return ethers.formatUnits(balance.toString(), 6) // For USDT typically 6 decimals
    } catch (error) {
      this.logger.error(`Failed to get ERC20 balance for address ${address}: ${error.message}`)
      throw error
    }
  }
}
