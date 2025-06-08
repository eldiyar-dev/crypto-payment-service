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
  decimals: number
}

type SendAllETHParams = {
  privateKey: string
  toAddress: string
}

type SendAllUSDTParams = {
  privateKey: string
  toAddress: string
}

@Injectable()
export class EthTransactionService {
  private readonly logger = new Logger(EthTransactionService.name)

  private readonly provider: ethers.JsonRpcProvider

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.provider = new ethers.JsonRpcProvider(`${this.configService.get('eth_rpc_url')}`)
  }

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  private get usdtContractAddress(): string {
    return this.configService.get('eth_usdt_contract_address')!
  }

  /**
   * Sends ETH to a specified address
   * @param {SendETHParams} params - Parameters for sending ETH
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {number} params.amount - The amount of ETH to send
   * @param {string} params.privateKey - The sender's private key
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   * @throws {Error} If there are insufficient funds for transfer and gas
   */
  async sendETH({ toAddress, amount, privateKey }: SendETHParams): Promise<string | null> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)
      const fromAddress = wallet.address

      // convert amount to wei
      let amountWei = ethers.parseEther(amount.toString())

      // get current gas parameters
      const feeData = await this.provider.getFeeData()
      const { maxFeePerGas, maxPriorityFeePerGas } = feeData

      // estimate gas for ETH transfer (usually 21000)
      const gasLimit = 21000

      // calculate total gas cost
      const totalGasCost = (maxFeePerGas ?? maxPriorityFeePerGas ?? 0n) * BigInt(gasLimit)

      // get ETH balance
      const balance = await this.provider.getBalance(fromAddress)

      // check if there are enough funds for transfer and gas
      if (balance < amountWei + totalGasCost) amountWei = balance - totalGasCost

      this.logger.log(`Sending ${ethers.formatEther(amountWei)} ETH to ${toAddress}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalGasCost)}`)

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
      this.logger.log(`ETH transfer to ${toAddress} ${amount} ETH complete. Transaction hash: ${txResponse.hash}`)

      return txResponse.hash
    } catch (error) {
      this.logger.error(`ETH transfer failed: ${error.message}`, error)
      return null
    }
  }

  /**
   * Sends ERC20 tokens to a specified address
   * @param {SendERC20TokenParams} params - Parameters for sending ERC20 tokens
   * @param {string} params.toAddress - The recipient's Ethereum address
   * @param {number} params.amount - The amount of tokens to send
   * @param {string} params.privateKey - The sender's private key
   * @param {string} params.contractAddress - The contract address of the ERC20 token
   * @param {number} params.decimals - The number of decimals of the ERC20 token
   * @returns {Promise<string | null>} The transaction hash if successful, null if failed
   */
  async sendERC20Token({ toAddress, amount, privateKey, contractAddress, decimals }: SendERC20TokenParams): Promise<string | null> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      const contract = new ethers.Contract(contractAddress, this.USDT_ABI, wallet)

      // Convert amount to wei (assuming decimals)
      const amountInWei = ethers.parseUnits(amount.toString(), decimals)

      const gasLimit = await contract.transfer.estimateGas(toAddress, amountInWei)

      // Get current gas parameters
      const { maxFeePerGas, maxPriorityFeePerGas } = await this.provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
      const totalFee = gasPrice * gasLimit

      this.logger.log(`Sending ${ethers.formatEther(amountInWei)} USDT to ${toAddress}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalFee)}`)

      // Send transaction
      const tx = await contract.transfer(toAddress, amountInWei, {
        gasLimit,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })
      const receipt = await tx.wait()
      this.logger.log(`Transaction send ERC20 to ${toAddress} receipt:`, receipt)

      return tx.hash
    } catch (error) {
      this.logger.error(`ERC20 transfer failed: ${error.message}`, error)
      return null
    }
  }

  /**
   * Sends all ETH from the sender's wallet to a specified address
   * @param {Object} params - The parameters for sending all ETH
   * @param {string} params.privateKey - The sender's private key
   * @param {string} params.toAddress - The recipient's address
   * @returns {Promise<string | null>} The transaction hash, or null if failed
   */
  async sendAllETH({ privateKey, toAddress }: SendAllETHParams): Promise<string | null> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)

      // get balance
      const balance = await this.provider.getBalance(wallet.address)

      // estimate fee
      const gasLimit = 21000
      const feeData = await this.provider.getFeeData()
      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n

      // for EIP-1559
      const gasPrice = maxFeePerGas
      const totalFee = gasPrice * BigInt(gasLimit)

      if (balance <= totalFee) {
        this.logger.error(`Not enough ETH to cover gas address: ${toAddress} balance: ${balance} fee: ${totalFee}`)
        return null
      }

      // amount to send = balance - fee
      const amountToSend = balance - totalFee

      this.logger.log(`Sending ${ethers.formatEther(amountToSend)} ETH to ${toAddress}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalFee)}`)

      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: amountToSend,
        gasLimit,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas,
      })

      const receipt = await tx.wait()
      this.logger.log(`Transaction send all ETH to ${toAddress} receipt:`, receipt)

      return tx.hash
    } catch (error) {
      this.logger.error(`ETH transfer failed to ${toAddress}: ${error.message}`, error)
      return null
    }
  }

  /**
   * Sends all USDT from the sender's wallet to a specified address
   * @param {Object} params - The parameters for sending all USDT
   * @param {string} params.privateKey - The sender's private key
   * @param {string} params.toAddress - The recipient's address
   * @returns {Promise<string | null>} The transaction hash, or null if failed
   */
  async sendAllUSDT({ privateKey, toAddress }: SendAllUSDTParams): Promise<string | null> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider)
      const contract = new ethers.Contract(this.usdtContractAddress, this.USDT_ABI, wallet)

      // Get USDT balance
      const usdtBalance = (await contract.balanceOf(wallet.address)) as bigint
      if (usdtBalance === 0n) {
        this.logger.error(`No USDT to send address: ${toAddress} balance: ${usdtBalance}`)
        return null
      }

      // Estimate fee
      const gasLimit = await contract.transfer.estimateGas(toAddress, usdtBalance)

      // Get current gas parameters
      const { maxFeePerGas, maxPriorityFeePerGas } = await this.provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n
      const totalFee = gasPrice * gasLimit

      // Check if there is enough ETH on the wallet to pay for the fee
      const ethBalance = await this.provider.getBalance(wallet.address)
      if (ethBalance < totalFee) {
        this.logger.error(`Not enough ETH to pay for gas address: ${toAddress} balance: ${ethBalance} fee: ${totalFee}`)
        return null
      }

      this.logger.log(`Sending ${ethers.formatEther(usdtBalance)} USDT to ${toAddress}`)
      this.logger.log(`Fee: ${ethers.formatEther(totalFee)}`)

      // Send all USDT
      const tx = await contract.transfer(toAddress, usdtBalance, {
        gasLimit,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
      })
      const receipt = await tx.wait()
      this.logger.log(`Transaction send all USDT to ${toAddress} receipt:`, receipt)

      return tx.hash
    } catch (error) {
      this.logger.error(`USDT transfer failed to ${toAddress}: ${error.message}`, error)
      return null
    }
  }
}
