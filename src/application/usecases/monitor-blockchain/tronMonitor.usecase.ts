import { Chain } from '@/common/enums'
import { formatBaseUnits, SerialQueue } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
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
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) {
      // Awaited, not fire-and-forget: starting the monitor before the allow-list is
      // populated means deposits arriving in that window are not recognised.
      await this.redisService.addAddress(Chain.TRON, dbWallets)
      await this.redisService.verifyAddressCache(Chain.TRON, dbWallets.length)
    }

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

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.TRON)
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
