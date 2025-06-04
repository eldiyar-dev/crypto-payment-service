import { BtcMonitorService } from '@/infrastructure/blockchain/btcMonitor.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class BtcMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(BtcMonitorUseCase.name)

  constructor(private readonly btcMonitorService: BtcMonitorService) {}

  onModuleInit() {
    this.btcMonitorService.start()
    this.execute()
  }

  execute(): void {
    this.logger.log('Starting BTC monitoring...')

    this.btcMonitorService.onDeposit((depositData) => {
      this.logger.log(`New BTC deposit: ${JSON.stringify(depositData)}`)
      // TODO:
    })
  }
}
