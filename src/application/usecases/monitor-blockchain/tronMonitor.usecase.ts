import { Chain, Currency } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TronMonitorService } from '../../../infrastructure/blockchain/tronMonitor.service'

@Injectable()
export class TronMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(TronMonitorUseCase.name)

  constructor(
    private readonly tronMonitorService: TronMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    dbWallets.forEach((wallet) => this.tronMonitorService.addAddress(wallet))

    this.execute()

    void this.tronMonitorService.start()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.TRON)
  }

  execute(): void {
    this.logger.log('Starting TRON monitoring...')

    this.tronMonitorService.onDeposit(({ address, amount }) => {
      this.logger.log(`New TRON deposit: ${address} ${amount}`)
      void this.depositService.notifyNewDeposit({ currency: Currency.TRX, address, amount })
    })
  }
}
