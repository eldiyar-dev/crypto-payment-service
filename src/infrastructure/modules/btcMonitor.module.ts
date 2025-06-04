import { BtcMonitorUseCase } from '@/application/usecases/monitor-blockchain/btcMonitor.usecase'
import { Module } from '@nestjs/common'
import { BtcMonitorService } from '../blockchain/btcMonitor.service'
import { DepositService } from '../clientApi/deposit.service'
import { WalletModule } from './wallet.module'

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [BtcMonitorUseCase, BtcMonitorService, DepositService],
  exports: [BtcMonitorUseCase],
})
export class BtcMonitorModule {}
