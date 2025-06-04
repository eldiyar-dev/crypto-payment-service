import { TronMonitorUseCase } from '@/application/usecases/monitor-blockchain/tronMonitor.usecase'
import { Module } from '@nestjs/common'
import { TronMonitorService } from '../blockchain/tronMonitor.service'

@Module({
  imports: [],
  controllers: [],
  providers: [TronMonitorUseCase, TronMonitorService],
  exports: [TronMonitorUseCase],
})
export class TronMonitorModule {}
