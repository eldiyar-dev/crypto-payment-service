import { Chain } from '@/common/enums'
import { formatBaseUnits, SerialQueue } from '@/common/utils'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { LeaderElectionService } from '@/infrastructure/redis/leaderElection.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { TronMonitorService } from '../../../infrastructure/blockchain/tron/tronMonitor.service'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class TronMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TronMonitorUseCase.name)

  /** Serial: concurrent sweeps race on the shared fee wallet's nonce and balance. */
  private readonly depositQueue = new SerialQueue(this.logger, 'TRON deposit')

  constructor(
    private readonly tronMonitorService: TronMonitorService,
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

    await this.tronMonitorService.start()
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down TRON monitoring (${signal ?? 'no signal'})`)

    this.depositQueue.close()
    this.tronMonitorService.stop()

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

    for await (const addresses of this.walletRepository.iterateAddressesByChain(Chain.TRON)) {
      await this.redisService.addAddress(Chain.TRON, addresses)
      total += addresses.length
    }

    if (total) await this.redisService.verifyAddressCache(Chain.TRON, total)
    this.logger.log(`Seeded ${total} TRON address(es)`)
  }

  execute(): void {
    this.logger.log('Starting TRON monitoring...')

    this.tronMonitorService.onDeposit(({ address, amount, decimals, currency, txHash, outputIndex, blockHash, blockNumber }) => {
      // Queued rather than started immediately: the monitor fires this for every deposit in a
      // block and advances lastCheckedBlock regardless, so without a queue every deposit in a
      // block swept concurrently.
      this.depositQueue.push(async () => {
        this.logger.log(`New TRON deposit: ${address} ${formatBaseUnits(amount, decimals)} ${currency}`)

        await this.processDepositUseCase.execute({ chain: Chain.TRON, currency, address, amount, decimals, txHash, outputIndex, blockHash, blockNumber })
      })

      return Promise.resolve()
    })
  }
}
