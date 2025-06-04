import { Currency } from '@/common/enums/currency.enum'
import { EthMonitorService } from '@/infrastructure/blockchain/ethMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly depositService: DepositService,
  ) {}

  onModuleInit() {
    void this.ethMonitorService.start()
    this.execute()
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount }) => {
      this.logger.log(`New ETH deposit: ${address} ${amount}`)
      void this.depositService.notifyNewDeposit({ currency: Currency.ETH, address, amount })
    })
  }
}
