import { BtcMonitorUseCase } from '@/application/usecases/monitor-blockchain/btcMonitor.usecase'
import { BtcInfoService } from '@/infrastructure/blockchain/btc/btcInfo.service'
import { BtcTransactionService } from '@/infrastructure/blockchain/btc/btcTransaction.service'
import { Module } from '@nestjs/common'
import { BtcMonitorService } from '../../blockchain/btc/btcMonitor.service'
import { DepositService } from '../../clientApi/deposit.service'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [BtcMonitorUseCase, BtcMonitorService, BtcTransactionService, BtcInfoService, DepositService],
  exports: [BtcMonitorUseCase, BtcTransactionService, BtcInfoService],
})
export class BtcBlockhainModule {}
