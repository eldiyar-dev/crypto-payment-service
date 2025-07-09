import { Chain } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TronMonitorService } from '../../../infrastructure/blockchain/tron/tronMonitor.service'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

@Injectable()
export class TronMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(TronMonitorUseCase.name)

  constructor(
    private readonly tronMonitorService: TronMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
    private readonly splitWithdrawUseCase: SplitWithdrawUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) void this.redisService.addAddress(Chain.TRON, dbWallets)

    this.execute()

    await this.tronMonitorService.start()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.TRON)
  }

  execute(): void {
    this.logger.log('Starting TRON monitoring...')

    this.tronMonitorService.onDeposit(async ({ address, amount, currency, txHash }) => {
      this.logger.log(`New TRON deposit: ${address} ${amount} ${currency}`)
      void this.depositService.notifyNewDeposit({ currency, address, amount, txHash, chain: Chain.TRON })

      await this.splitWithdrawUseCase.execute({ currency, address, amount, chain: Chain.TRON })
    })
  }
}
