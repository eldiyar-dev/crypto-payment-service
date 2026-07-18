import { Chain } from '@/common/enums'
import { AnkrTransaction } from '@/common/interfaces'
import { BTC_DECIMALS, formatBaseUnits, parseBaseUnits } from '@/common/utils'
import { ChainCheckpointRepository } from '@/domain/repositories/chainCheckpointRepository'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BtcInfoService } from './btcInfo.service'

type DepositCallback = (data: {
  address: string
  amount: bigint
  decimals: number
  txHash: string
  /** The vout index, so two outputs to the same address in one tx stay distinct. */
  outputIndex: number
}) => void

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly btcInfoService: BtcInfoService,
    private readonly configService: ConfigService<TConfiguration>,
    private readonly chainCheckpointRepository: ChainCheckpointRepository,
  ) {}

  private depositCallback: DepositCallback

  /** Config-driven so the depth can be raised without a redeploy. */
  private get confirmationsThreshold(): number {
    return this.configService.get(`confirmations.${Chain.BTC}`, { infer: true })!
  }

  /** Dust threshold: 0.00005 BTC (~$5), in satoshi. */
  private readonly minBtcDeposit = parseBaseUnits('0.00005', BTC_DECIMALS)
  private lastProcessedBlock: number
  private readonly POLLING_INTERVAL = 60_000
  private intervalId: NodeJS.Timeout | null = null

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start() {
    // Moved off Redis: `allkeys-lru` could evict this key, silently resetting the scanner to
    // the chain tip and skipping every deposit in between.
    this.lastProcessedBlock = (await this.chainCheckpointRepository.getLastScannedBlock(Chain.BTC)) ?? 0

    this.stop()
    // The handle was previously discarded, so the interval could never be cleared and kept
    // firing through shutdown.
    this.intervalId = setInterval(() => void this.pollForNewBlocks(), this.POLLING_INTERVAL) // Poll every minute
    void this.pollForNewBlocks()
  }

  stop() {
    if (!this.intervalId) return

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  private async pollForNewBlocks() {
    try {
      void this.checkPendingDeposits()

      this.logger.log('Polling for new blocks...')
      const latestBlockHeight = await this.btcInfoService.getLatestBlockHeight()

      if (!this.lastProcessedBlock) {
        this.logger.log(`Initializing last processed block to ${latestBlockHeight}`)
        this.lastProcessedBlock = latestBlockHeight
        await this.chainCheckpointRepository.setLastScannedBlock(Chain.BTC, latestBlockHeight)
        return
      }

      if (latestBlockHeight > this.lastProcessedBlock) {
        this.logger.log(`New blocks detected. From ${this.lastProcessedBlock + 1} to ${latestBlockHeight}`)
        for (let height = this.lastProcessedBlock + 1; height <= latestBlockHeight; height++) {
          await this.processBlock(height)
          await this.chainCheckpointRepository.setLastScannedBlock(Chain.BTC, height)
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
      const txs = await this.btcInfoService.getBlockByHeightAllPages(height)
      if (!txs.length) {
        this.logger.warn(`Block ${height} not found or has no transactions.`)
        return
      }

      // One batched SMISMEMBER for the whole block, instead of loading every monitored
      // address and rebuilding a 3M-element Set per block.
      const candidates = txs.flatMap((tx) => tx.vout.flatMap((output) => output.addresses ?? []))
      const monitored = await this.redisService.filterKnownAddresses(Chain.BTC, candidates)
      if (!monitored.size) return

      for (const tx of txs) {
        for (const output of tx.vout) {
          if (!output?.addresses?.length) continue

          for (const address of output.addresses) {
            if (!monitored.has(address)) continue

            await this.redisService.setBtcPendingTransaction(tx.txid)
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error processing block ${height}: ${String(error)}`)
    }
  }

  private async checkPendingDeposits() {
    const pendingTxs = await this.redisService.getBtcPendingTransactions()
    if (!pendingTxs.length) return

    for (const txid of pendingTxs) {
      const tx = await this.btcInfoService.getTxByHash(txid)
      if (!tx) continue

      const confirmations = tx.confirmations
      if (confirmations < this.confirmationsThreshold) continue

      await this.checkDeposit(tx)

      await this.redisService.removeBtcPendingTransaction(txid)
    }
  }

  private async checkDeposit(tx: AnkrTransaction) {
    const candidates = tx.vout.flatMap((output) => output.addresses ?? [])
    const monitored = await this.redisService.filterKnownAddresses(Chain.BTC, candidates)
    if (!monitored.size) return

    for (const output of tx.vout) {
      if (!output?.addresses?.length) continue

      for (const address of output.addresses) {
        if (!monitored.has(address)) continue

        // output.value is a satoshi string — keep it exact.
        const amountSatoshi = BigInt(output.value)

        // Ignore small deposits (0.00005 BTC) 5$
        if (amountSatoshi < this.minBtcDeposit) continue

        this.logger.log(`Deposit detected: to ${address}, amount ${formatBaseUnits(amountSatoshi, BTC_DECIMALS)} BTC, txid: ${tx.txid}`)
        this.depositCallback({ address, amount: amountSatoshi, decimals: BTC_DECIMALS, txHash: tx.txid, outputIndex: output.n })
      }
    }
  }
}
