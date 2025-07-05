import { Chain, Currency } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

@Injectable()
export class BtcMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(BtcMonitorUseCase.name)

  constructor(
    private readonly btcMonitorService: BtcMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
    private readonly splitWithdrawUseCase: SplitWithdrawUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) void this.redisService.addAddress(Chain.BTC, dbWallets)

    this.execute()

    await this.btcMonitorService.start()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.BTC)
  }

  execute(): void {
    this.logger.log('Starting BTC monitoring...')

    this.btcMonitorService.onDeposit(({ address, amount }) => {
      this.logger.log(`New BTC deposit: ${address} ${amount}`)
      void this.depositService.notifyNewDeposit({ currency: Currency.BTC, address, amount })
      void this.splitWithdrawUseCase.execute({ currency: Currency.BTC, address, amount, chain: Chain.BTC })
    })
  }
}
