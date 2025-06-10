import { Chain } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
    private readonly splitWithdrawUseCase: SplitWithdrawUseCase,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    dbWallets.forEach((wallet) => this.ethMonitorService.addAddress(wallet))

    this.execute()

    this.ethMonitorService.start()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.ETH)
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount, currency, txHash }) => {
      this.logger.log(`New ETH deposit: ${address} ${amount} ${currency} txHash: ${txHash}`)
      void this.depositService.notifyNewDeposit({ currency, address, amount, txHash })

      void this.splitWithdrawUseCase.execute({ currency, address, amount, chain: Chain.ETH })
    })
  }
}
