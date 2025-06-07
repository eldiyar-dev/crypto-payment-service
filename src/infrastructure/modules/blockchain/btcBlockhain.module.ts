import { BtcMonitorUseCase } from '@/application/usecases/monitor-blockchain/btcMonitor.usecase'
import { BtcInfoService, BtcMonitorService, BtcTransactionService } from '@/infrastructure/blockchain/btc'
import { Module } from '@nestjs/common'
import { DepositService } from '../../clientApi/deposit.service'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [BtcMonitorUseCase, BtcMonitorService, BtcTransactionService, BtcInfoService, DepositService],
  exports: [BtcMonitorUseCase, BtcTransactionService, BtcInfoService],
})
export class BtcBlockhainModule {}
