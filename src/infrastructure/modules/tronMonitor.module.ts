import { TronMonitorUseCase } from '@/application/usecases/monitor-blockchain/tronMonitor.usecase'
import { Module } from '@nestjs/common'
import { TronMonitorService } from '../blockchain/tronMonitor.service'
import { DepositService } from '../clientApi/deposit.service'

@Module({
  imports: [],
  controllers: [],
  providers: [TronMonitorUseCase, TronMonitorService, DepositService],
  exports: [TronMonitorUseCase],
})
export class TronMonitorModule {}
