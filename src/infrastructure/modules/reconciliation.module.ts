import { ReconcileDepositsUseCase } from '@/application/usecases/reconciliation/reconcileDeposits.usecase'
import { Module } from '@nestjs/common'
import { BtcInfoService } from '../blockchain/btc'
import { EthInfoService } from '../blockchain/eth/ethInfo.service'
import { EvmProviderFactory } from '../blockchain/eth/evmProvider.factory'
import { TronInfoService } from '../blockchain/tron'
import { ReportService } from '../clientApi/report.service'

/**
 * Periodic ledger-vs-chain reconciliation. Read-only: it alerts, it never moves funds.
 */
@Module({
  providers: [ReconcileDepositsUseCase, ReportService, EthInfoService, EvmProviderFactory, TronInfoService, BtcInfoService],
  exports: [ReconcileDepositsUseCase],
})
export class ReconciliationModule {}
