import { Chain } from '@/common/enums'
import { formatBaseUnits } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  private readonly depositQueue: Array<() => Promise<void>> = []
  /** The in-flight drain, if any. Awaited on shutdown so work is not abandoned mid-flight. */
  private queueRun: Promise<void> | null = null
  private shuttingDown = false

  /** Starts a drain if one is not already running. */
  private scheduleQueue() {
    if (this.queueRun) return

    this.queueRun = this.processQueue().finally(() => {
      this.queueRun = null
    })
    void this.queueRun
  }

  private async processQueue() {
    while (this.depositQueue.length > 0) {
      const task = this.depositQueue.shift()
      if (!task) continue

      try {
        await task()
      } catch (err) {
        this.logger.error('Error processing deposit queue task', err)
      }
    }
  }

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly walletRepository: WalletRepository,
    private readonly processDepositUseCase: ProcessDepositUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) {
      // Awaited, not fire-and-forget: starting the monitor before the allow-list is
      // populated means deposits arriving in that window are not recognised.
      await this.redisService.addAddress(Chain.ETH, dbWallets)
      await this.redisService.verifyAddressCache(Chain.ETH, dbWallets.length)
    }

    this.execute()

    void this.ethMonitorService.start(Chain.ETH)
    // void this.ethMonitorService.start(Chain.EVM_BASE)
    // void this.ethMonitorService.start(Chain.EVM_BSC)
    // void this.ethMonitorService.start(Chain.EVM_POLYGON)
    // void this.ethMonitorService.start(Chain.EVM_ARBITRUM)
    // void this.ethMonitorService.start(Chain.EVM_OPTIMISM)
    // void this.ethMonitorService.start(Chain.EVM_AVALANCHE_C)
    // void this.ethMonitorService.start(Chain.EVM_FANTOM)
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.ETH)
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount, decimals, currency, txHash, outputIndex, blockHash, blockNumber, evmNetwork }) => {
      if (this.shuttingDown) {
        // The deposit is recorded on-chain and the scan checkpoint has not advanced past it,
        // so the next boot re-detects it. Dropping it here is safe; starting a withdrawal we
        // cannot finish is not.
        this.logger.warn(`Shutting down; deferring deposit ${txHash} to the next start`)
        return
      }

      this.depositQueue.push(async () => {
        this.logger.log(`New ETH deposit: ${address} ${formatBaseUnits(amount, decimals)} ${currency} txHash: ${txHash} evmNetwork: ${evmNetwork}`)

        await this.processDepositUseCase.execute({ chain: evmNetwork, currency, address, amount, decimals, txHash, outputIndex, blockHash, blockNumber })
      })
      this.scheduleQueue()
    })
  }

  /**
   * Stops accepting new deposits and drains what is already queued.
   *
   * Nest only calls this once `enableShutdownHooks()` is on. Without it, every deploy dropped
   * the in-memory queue and could kill a withdrawal after broadcast but before the ledger was
   * updated — money moved on-chain with no record of it.
   */
  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down ETH monitoring (${signal ?? 'no signal'})`)
    this.shuttingDown = true

    await this.ethMonitorService.stop()

    if (this.queueRun) {
      this.logger.log(`Draining ${this.depositQueue.length} queued deposit(s)`)
      await this.queueRun
    }

    this.logger.log('ETH monitoring stopped')
  }
}
