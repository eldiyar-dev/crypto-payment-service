import { EthMonitorUseCase } from '@/application/usecases/monitor-blockchain/ethMonitor.usecase'
import { EthInfoService } from '@/infrastructure/blockchain/eth/ethInfo.service'
import { EthTransactionService } from '@/infrastructure/blockchain/eth/ethTransaction.service'
import { Module } from '@nestjs/common'
import { EthMonitorService } from '../../blockchain/eth/ethMonitor.service'
import { DepositService } from '../../clientApi/deposit.service'
import { WalletModule } from '../wallet.module'

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [EthMonitorUseCase, EthMonitorService, EthTransactionService, EthInfoService, DepositService],
  exports: [EthMonitorUseCase, EthInfoService, EthTransactionService],
})
export class EthBlockhainModule {}
