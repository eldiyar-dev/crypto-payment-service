import { Module } from '@nestjs/common'
import { EthMonitorService } from '../blockchain/ethMonitor.service'
import { EthMonitorUseCase } from '@/aplication/usecases/monitor-blockchain/eth-monitor.usecase'

@Module({
  imports: [],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService],
  exports: [EthMonitorUseCase],
})
export class EthMonitorModule {}
