import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class BtcMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BtcMonitorUseCase.name)

  constructor(
    private readonly btcMonitorService: BtcMonitorService,
    private readonly walletRepository: WalletRepository,
    private readonly processDepositUseCase: ProcessDepositUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) void this.redisService.addAddress(Chain.BTC, dbWallets)

    this.execute()

    await this.btcMonitorService.start()
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down BTC monitoring (${signal ?? 'no signal'})`)
    this.btcMonitorService.stop()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.BTC)
  }

  execute(): void {
    this.logger.log('Starting BTC monitoring...')

    this.btcMonitorService.onDeposit(({ address, amount, decimals, txHash, outputIndex }) => {
      this.logger.log(`New BTC deposit: ${address} ${formatBaseUnits(amount, decimals)}`)
      void this.processDepositUseCase.execute({ chain: Chain.BTC, currency: Currency.BTC, address, amount, decimals, txHash, outputIndex })
    })
  }
}
