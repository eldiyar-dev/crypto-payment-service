import { Chain, Currency } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    dbWallets.forEach((wallet) => this.ethMonitorService.addAddress(wallet))

    this.execute()

    void this.ethMonitorService.start()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.ETH)
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount }) => {
      this.logger.log(`New ETH deposit: ${address} ${amount}`)
      void this.depositService.notifyNewDeposit({ currency: Currency.ETH, address, amount })
    })
  }
}
