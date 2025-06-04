import { Currency } from '@/common/enums/currency.enum'
import { BtcMonitorService } from '@/infrastructure/blockchain/btcMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class BtcMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(BtcMonitorUseCase.name)

  constructor(
    private readonly btcMonitorService: BtcMonitorService,
    private readonly depositService: DepositService,
  ) {}

  onModuleInit() {
    this.btcMonitorService.start()
    this.execute()
  }

  execute(): void {
    this.logger.log('Starting BTC monitoring...')

    this.btcMonitorService.onDeposit(({ address, amount }) => {
      this.logger.log(`New BTC deposit: ${address} ${amount}`)
      void this.depositService.notifyNewDeposit({ currency: Currency.BTC, address, amount })
    })
  }
}
