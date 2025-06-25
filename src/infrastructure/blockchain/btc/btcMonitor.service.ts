import { Chain } from '@/common/enums'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { BtcInfoService } from './btcInfo.service'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly btcInfoService: BtcInfoService,
  ) {}

  private depositCallback: DepositCallback

  private readonly confirmationsThreshold = 2
  private lastProcessedBlock: number
  private readonly POLLING_INTERVAL = 60_000

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  addAddress(address: string) {
    try {
      this.logger.log(`Added address ${address} to monitor`)
    } catch (error) {
      this.logger.error(`Error adding address ${address} to monitor ${(error as Error).message}`)
    }
  }

  async getAddresses(): Promise<string[]> {
    return this.redisService.getAddresses(Chain.BTC)
  }

  async start() {
    this.lastProcessedBlock = (await this.redisService.get<number>('last-processed-block-btc')) ?? 0
    setInterval(() => this.pollForNewBlocks(), this.POLLING_INTERVAL) // Poll every minute
    void this.pollForNewBlocks()
  }

  private async pollForNewBlocks() {
    try {
      this.logger.log('Polling for new blocks...')
      const latestBlockHeight = await this.btcInfoService.getLatestBlockHeight()

      if (!this.lastProcessedBlock) {
        this.logger.log(`Initializing last processed block to ${latestBlockHeight}`)
        this.lastProcessedBlock = latestBlockHeight
        await this.redisService.set('last-processed-block-btc', latestBlockHeight)
        return
      }

      if (latestBlockHeight > this.lastProcessedBlock) {
        this.logger.log(`New blocks detected. From ${this.lastProcessedBlock + 1} to ${latestBlockHeight}`)
        for (let height = this.lastProcessedBlock + 1; height <= latestBlockHeight; height++) {
          await this.processBlock(height)
          await this.redisService.set('last-processed-block-btc', height)
          this.lastProcessedBlock = height
        }
      }
    } catch (error) {
      this.logger.error(`Error polling for new blocks: ${String(error)}`)
    }
  }

  private async processBlock(height: number) {
    try {
      this.logger.log(`Processing block ${height}`)
      const txs = await this.btcInfoService.getBlockByHeight(height)
      if (!txs.length) {
        this.logger.warn(`Block ${height} not found or has no transactions.`)
        return
      }

      const monitoredAddresses = await this.getAddresses()
      if (!monitoredAddresses.length) return

      const monitoredAddressesSet = new Set(monitoredAddresses)

      for (const tx of txs) {
        if (tx.confirmations < this.confirmationsThreshold) continue

        for (const output of tx.vout) {
          if (!output?.addresses?.length) continue

          for (const address of output.addresses) {
            if (!monitoredAddressesSet.has(address)) continue

            const amountBTC = +output.value / 1e8

            // Ignore small deposits (0.00005 BTC) 5$
            if (amountBTC < 0.00005) continue

            this.logger.log(`Deposit detected: to ${address}, amount ${amountBTC} BTC, txid: ${tx.txid}`)
            this.depositCallback({ address, amount: amountBTC })
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error processing block ${height}: ${String(error)}`)
    }
  }
}
