import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits, SerialQueue } from '@/common/utils'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { LeaderElectionService } from '@/infrastructure/redis/leaderElection.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class BtcMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BtcMonitorUseCase.name)

  /** Serial: concurrent sweeps race on the shared fee wallet's nonce and balance. */
  private readonly depositQueue = new SerialQueue(this.logger, 'BTC deposit')

  constructor(
    private readonly btcMonitorService: BtcMonitorService,
    private readonly walletRepository: WalletRepository,
    private readonly processDepositUseCase: ProcessDepositUseCase,
    private readonly redisService: RedisService,
    private readonly leaderElectionService: LeaderElectionService,
  ) {}

  async onModuleInit() {
    // Only one instance may run the monitors. Without this, raising PM2 `instances`
    // makes every instance scan the same blocks.
    if (!(await this.leaderElectionService.acquire())) return

    await this.seedAddressCache()

    this.execute()

    await this.btcMonitorService.start()
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down BTC monitoring (${signal ?? 'no signal'})`)

    this.depositQueue.close()
    this.btcMonitorService.stop()

    this.logger.log(`Draining ${this.depositQueue.size} queued deposit(s)`)
    await this.depositQueue.drain()
  }

  /**
   * Rebuilds the monitored-address cache from Postgres, which is authoritative.
   *
   * Streamed in batches rather than loaded into one array: at 3M+ wallets a single query
   * materialises the whole set in memory before the monitor can start. Awaited, because
   * starting the monitor before the allow-list is populated means deposits arriving in that
   * window are not recognised.
   */
  private async seedAddressCache(): Promise<void> {
    let total = 0

    for await (const addresses of this.walletRepository.iterateAddressesByChain(Chain.BTC)) {
      await this.redisService.addAddress(Chain.BTC, addresses)
      total += addresses.length
    }

    if (total) await this.redisService.verifyAddressCache(Chain.BTC, total)
    this.logger.log(`Seeded ${total} BTC address(es)`)
  }

  execute(): void {
    this.logger.log('Starting BTC monitoring...')

    this.btcMonitorService.onDeposit(({ address, amount, decimals, txHash, outputIndex }) => {
      // Queued rather than fired with `void`: two deposits confirming in the same pass would
      // otherwise sweep concurrently, and on BTC each sweep spends the whole UTXO set.
      this.depositQueue.push(async () => {
        this.logger.log(`New BTC deposit: ${address} ${formatBaseUnits(amount, decimals)}`)
        await this.processDepositUseCase.execute({ chain: Chain.BTC, currency: Currency.BTC, address, amount, decimals, txHash, outputIndex })
      })
    })
  }
}
