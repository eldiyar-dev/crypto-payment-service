import { TronMonitorUseCase } from '@/aplication/usecases/monitor-blockchain/tron-monitor.usecase'
import { Module } from '@nestjs/common'
import { TronMonitorService } from '../blockchain/tronMonitor.service'

@Module({
  imports: [],
  controllers: [],
  providers: [TronMonitorUseCase, TronMonitorService],
  exports: [TronMonitorUseCase],
})
export class TronMonitorModule {}
