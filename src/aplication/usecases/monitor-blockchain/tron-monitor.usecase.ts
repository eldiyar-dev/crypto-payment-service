import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TronMonitorService } from '../../../infrastructure/blockchain/tronMonitor.service'

@Injectable()
export class TronMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(TronMonitorUseCase.name)

  constructor(private readonly tronMonitorService: TronMonitorService) {}

  onModuleInit() {
    void this.tronMonitorService.start()
    this.execute()
  }

  execute(): void {
    this.logger.log('Starting TRON monitoring...')

    this.tronMonitorService.onDeposit((depositData) => {
      this.logger.log(`New TRON deposit: ${JSON.stringify(depositData)}`)
      // TODO:
    })
  }
}
