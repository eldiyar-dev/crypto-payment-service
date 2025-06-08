import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

type SendETHParams = {
  toAddress: string
  amount: number
  privateKey: string
}

type SendERC20TokenParams = {
  toAddress: string
  amount: number
  privateKey: string
  contractAddress: string
}

@Injectable()
export class EthTransactionService {
  private readonly logger = new Logger(EthTransactionService.name)

  private readonly provider: ethers.JsonRpcProvider

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${this.configService.get('infura_api_key')}`)
  }

  async sendETH({ toAddress, amount, privateKey }: SendETHParams) {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      // Convert amount to wei
      const amountInWei = ethers.parseEther(amount.toString())

      // Create transaction
      const transaction = {
        to: toAddress,
        value: amountInWei,
        gasLimit: 21000, // Standard limit for ETH transactions
      }

      // Get current gas price
      const gasPrice = await this.provider.getFeeData()
      transaction['maxFeePerGas'] = gasPrice.maxFeePerGas
      transaction['maxPriorityFeePerGas'] = gasPrice.maxPriorityFeePerGas

      // Send transaction
      const tx = await wallet.sendTransaction(transaction)
      const receipt = await tx.wait()

      return receipt
    } catch (error) {
      this.logger.error(`ETH transfer failed: ${error.message}`, error)
      return null
    }
  }

  async sendERC20Token({ toAddress, amount, privateKey, contractAddress }: SendERC20TokenParams) {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      // ABI for transfer function
      const abi = ['function transfer(address to, uint256 amount) returns (bool)']

      const contract = new ethers.Contract(contractAddress, abi, wallet)

      // Convert amount to wei (assuming 6 decimals)
      const amountInWei = ethers.parseUnits(amount.toString(), 6)

      // Send transaction
      const tx = await contract.transfer(toAddress, amountInWei)
      const receipt = await tx.wait()

      return receipt
    } catch (error) {
      this.logger.error(`ERC20 transfer failed: ${error.message}`, error)
      return null
    }
  }
}
