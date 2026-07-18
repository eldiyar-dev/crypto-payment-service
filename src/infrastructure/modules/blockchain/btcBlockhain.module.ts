import { BtcMonitorUseCase } from '@/application/usecases/monitor-blockchain/btcMonitor.usecase'
import { BtcInfoService, BtcMonitorService, BtcTransactionService } from '@/infrastructure/blockchain/btc'
import { ProcessDepositUseCase } from '@/application/usecases/monitor-blockchain/processDeposit.usecase'
import { Module } from '@nestjs/common'
import { DepositService } from '../../clientApi/deposit.service'
import { ReportService } from '../../clientApi/report.service'
import { SplitWithdrawModule } from '../splitWithdraw.module'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule, SplitWithdrawModule],
  controllers: [],
  providers: [BtcMonitorUseCase, BtcMonitorService, BtcTransactionService, BtcInfoService, DepositService, ProcessDepositUseCase, ReportService],
  exports: [BtcMonitorUseCase, BtcTransactionService, BtcInfoService],
})
export class BtcBlockhainModule {}
