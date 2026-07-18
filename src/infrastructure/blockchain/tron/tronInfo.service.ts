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
    this.tronWeb = new TronWeb({ fullHost: this.configService.get('tron_host_url')! })
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
   * Wait for a Tron transaction to be mined AND to have succeeded.
   *
   * A mined transaction is not a successful one: a TRC20 transfer that runs out of energy is
   * included in a block with `receipt.result = 'OUT_OF_ENERGY'`. Treating any `blockNumber` as
   * confirmation reported reverted transfers as completed withdrawals. Native TRX transfers
   * carry no `receipt.result`, so its absence is treated as success.
   *
   * Transient RPC errors are tolerated: previously an exception inside the loop aborted the
   * whole wait, which the caller could not distinguish from a genuine failure.
   *
   * @param txHash - The hash of the transaction to wait for
   * @param maxAttempts - Maximum one-second polls before giving up
   * @returns The block number if the transaction succeeded, null if it reverted or timed out
   */
  async waitForTronTxConfirmation(txHash: string, maxAttempts = 1_200): Promise<number | null> {
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      try {
        const txInfo = await this.tronWeb.trx.getTransactionInfo(txHash)

        if (txInfo?.blockNumber) {
          const result = txInfo.receipt?.result
          if (result && result !== 'SUCCESS') {
            this.logger.error(`Transaction ${txHash} was mined but failed on-chain: ${result}`)
            return null
          }
          return txInfo.blockNumber
        }
      } catch (error) {
        this.logger.debug(`Polling ${txHash} failed, retrying: ${(error as Error).message}`)
      }

      await sleep(1_000)
    }

    this.logger.error(`Transaction ${txHash} not confirmed in time`)
    return null
  }
}
