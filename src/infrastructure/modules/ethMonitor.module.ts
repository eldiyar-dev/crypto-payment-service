import { EthMonitorUseCase } from '@/application/usecases/monitor-blockchain/ethMonitor.usecase'
import { Module } from '@nestjs/common'
import { EthMonitorService } from '../blockchain/ethMonitor.service'
import { DepositService } from '../clientApi/deposit.service'
import { WalletModule } from './wallet.module'

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService, DepositService],
  exports: [EthMonitorUseCase],
})
export class EthMonitorModule {}
