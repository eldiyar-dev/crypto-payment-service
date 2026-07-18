import { EthMonitorUseCase } from '@/application/usecases/monitor-blockchain/ethMonitor.usecase'
import { EthInfoService, EthMonitorService, EthTransactionService, EvmProviderFactory } from '@/infrastructure/blockchain/eth'
import { ProcessDepositUseCase } from '@/application/usecases/monitor-blockchain/processDeposit.usecase'
import { Module } from '@nestjs/common'
import { DepositService } from '../../clientApi/deposit.service'
import { SplitWithdrawModule } from '../splitWithdraw.module'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule, SplitWithdrawModule],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService, EthTransactionService, EthInfoService, EvmProviderFactory, DepositService, ProcessDepositUseCase],
  exports: [EthMonitorUseCase, EthInfoService, EthTransactionService],
})
export class EthBlockhainModule {}
