import { Injectable } from '@nestjs/common'
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
  private readonly provider: ethers.JsonRpcProvider

  constructor() {
    this.provider = new ethers.JsonRpcProvider('YOUR_ETH_NODE_URL')
  }

  async sendETH({ toAddress, amount, privateKey }: SendETHParams) {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      // Конвертируем сумму в wei
      const amountInWei = ethers.parseEther(amount.toString())

      // Создаем транзакцию
      const transaction = {
        to: toAddress,
        value: amountInWei,
        gasLimit: 21000, // Стандартный лимит для ETH транзакций
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
      throw new Error(`ETH transfer failed: ${error.message}`)
    }
  }

  async sendERC20Token({ toAddress, amount, privateKey, contractAddress }: SendERC20TokenParams) {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      // ABI для функции transfer
      const abi = ['function transfer(address to, uint256 amount) returns (bool)']

      const contract = new ethers.Contract(contractAddress, abi, wallet)

      // Конвертируем сумму в wei (предполагаем 18 decimals)
      const amountInWei = ethers.parseUnits(amount.toString(), 18)

      // Отправляем транзакцию
      const tx = await contract.transfer(toAddress, amountInWei)
      const receipt = await tx.wait()

      return receipt
    } catch (error) {
      throw new Error(`ERC20 transfer failed: ${error.message}`)
    }
  }
}
