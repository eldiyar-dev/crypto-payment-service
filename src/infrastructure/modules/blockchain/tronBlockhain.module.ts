import { TronMonitorUseCase } from '@/application/usecases/monitor-blockchain/tronMonitor.usecase'
import { TronEnergyService, TronInfoService, TronMonitorService, TronTransactionService } from '@/infrastructure/blockchain/tron'
import { Module } from '@nestjs/common'
import { DepositService } from '../../clientApi/deposit.service'
import { SplitWithdrawModule } from '../splitWithdraw.module'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule, SplitWithdrawModule],
  controllers: [],
  providers: [TronMonitorUseCase, TronMonitorService, TronTransactionService, TronInfoService, DepositService, TronEnergyService],
  exports: [TronMonitorUseCase, TronTransactionService, TronInfoService, TronEnergyService],
})
export class TronBlockhainModule {}
