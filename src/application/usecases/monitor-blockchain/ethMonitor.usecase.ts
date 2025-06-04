import { EthMonitorService } from '@/infrastructure/blockchain/ethMonitor.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  constructor(private readonly ethMonitorService: EthMonitorService) {}

  onModuleInit() {
    void this.ethMonitorService.start()
    this.execute()
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit((depositData) => {
      this.logger.log(`New ETH deposit: ${JSON.stringify(depositData)}`)
      // TODO:
    })
  }
}
