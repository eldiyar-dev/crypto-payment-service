import { TronMonitorUseCase } from '@/application/usecases/monitor-blockchain/tronMonitor.usecase'
import { TronInfoService } from '@/infrastructure/blockchain/tron/tronInfo.service'
import { TronMonitorService } from '@/infrastructure/blockchain/tron/tronMonitor.service'
import { TronTransactionService } from '@/infrastructure/blockchain/tron/tronTransaction.service'
import { Module } from '@nestjs/common'
import { DepositService } from '../../clientApi/deposit.service'
import { SplitWithdrawModule } from '../splitWithdraw.module'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule, SplitWithdrawModule],
  controllers: [],
  providers: [TronMonitorUseCase, TronMonitorService, TronTransactionService, TronInfoService, DepositService],
  exports: [TronMonitorUseCase, TronTransactionService, TronInfoService],
})
export class TronBlockhainModule {}
