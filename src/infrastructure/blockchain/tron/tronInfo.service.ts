import { sleep } from '@/common/utils'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import type { TConfiguration } from '../../config/configuration'

@Injectable()
export class TronInfoService {
  private readonly logger = new Logger(TronInfoService.name)
  private readonly tronWeb: TronWeb

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.tronWeb = new TronWeb({
      fullHost: this.configService.get('tron_host_url')!,
      headers: { 'TRON-PRO-API-KEY': this.configService.get('tron_pro_api_key')! },
    })
  }

  /**
   * Get the TRX balance for a given address
   * @param address - The Tron address to check
   * @returns The balance in TRX as a number
   */
  async getTRXBalance(address: string): Promise<number> {
    try {
      const balance = await this.tronWeb.trx.getBalance(address)
      return balance / 1e6 // Convert SUN to TRX
    } catch (error) {
      this.logger.error(`Failed to get TRX balance for address ${address}: ${error.message}`)
      throw error
    }
  }

  /**
   * Get the TRC20 token balance for a given address
   * @param address - The Tron address to check
   * @param contractAddress - The TRC20 token contract address
   * @returns The token balance as a number
   */
  async getTRC20Balance(address: string, contractAddress: string): Promise<number> {
    try {
      const contract = await this.tronWeb.contract().at(contractAddress)
      const balance = await contract.balanceOf(address).call()
      return Number(balance) / 1e6 // For USDT typically 6 decimals
    } catch (error) {
      this.logger.error(`Failed to get TRC20 balance for address ${address}: ${error.message}`)
      throw error
    }
  }

  /**
   * Get the available energy for a given address
   * @param address - The Tron address to check
   * @returns The available energy as a number
   */
  async getTronEnergy(address: string): Promise<number> {
    try {
      const resources = await this.tronWeb.trx.getAccountResources(address)
      return resources.EnergyLimit - resources.EnergyUsed
    } catch (error) {
      this.logger.error(`Failed to get energy for address ${address}: ${error.message}`)
      throw error
    }
  }

  /**
   * Wait for a Tron transaction to be confirmed
   * @param txHash - The hash of the transaction to wait for
   * @param maxAttempts - The maximum number of attempts to wait for the transaction to be confirmed
   * @returns The block number of the confirmed transaction
   */
  async waitForTronTxConfirmation(txHash: string, maxAttempts = 1_200): Promise<number | null> {
    let attempts = 0
    while (attempts < maxAttempts) {
      const txInfo = await this.tronWeb.trx.getTransactionInfo(txHash)
      if (txInfo?.blockNumber) return txInfo?.blockNumber
      await sleep(500)
      attempts++
    }
    this.logger.error(`Transaction ${txHash} not confirmed in time`)
    return null
  }
}
