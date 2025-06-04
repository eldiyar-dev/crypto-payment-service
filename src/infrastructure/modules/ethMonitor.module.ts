import { EthMonitorUseCase } from '@/application/usecases/monitor-blockchain/ethMonitor.usecase'
import { Module } from '@nestjs/common'
import { EthMonitorService } from '../blockchain/ethMonitor.service'
import { DepositService } from '../clientApi/deposit.service'

@Module({
  imports: [],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService, DepositService],
  exports: [EthMonitorUseCase],
})
export class EthMonitorModule {}
