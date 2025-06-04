import { EthMonitorUseCase } from '@/application/usecases/monitor-blockchain/ethMonitor.usecase'
import { Module } from '@nestjs/common'
import { EthMonitorService } from '../blockchain/ethMonitor.service'

@Module({
  imports: [],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService],
  exports: [EthMonitorUseCase],
})
export class EthMonitorModule {}
