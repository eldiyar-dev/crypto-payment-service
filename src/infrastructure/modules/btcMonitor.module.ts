import { BtcMonitorUseCase } from '@/application/usecases/monitor-blockchain/btcMonitor.usecase'
import { Module } from '@nestjs/common'
import { BtcMonitorService } from '../blockchain/btcMonitor.service'

@Module({
  imports: [],
  controllers: [],
  providers: [BtcMonitorUseCase, BtcMonitorService],
  exports: [BtcMonitorUseCase],
})
export class BtcMonitorModule {}
