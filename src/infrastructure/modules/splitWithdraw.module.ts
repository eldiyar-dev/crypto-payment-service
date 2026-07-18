import { SplitWithdrawUseCase } from '@/application/usecases/autoWithdraw/splitWithdraw.usecase'
import { AESCipherService } from '@/common/services/aes.service'
import { Module } from '@nestjs/common'
import { BtcInfoService, BtcTransactionService } from '../blockchain/btc'
import { EthInfoService } from '../blockchain/eth/ethInfo.service'
import { TronEnergyService, TronInfoService } from '../blockchain/tron'
import { ReportService } from '../clientApi/report.service'
import { WithdrawService } from '../clientApi/withdraw.service'
import { WalletModule } from './wallet.module'

@Module({
  imports: [WalletModule],
  // BtcTransactionService and BtcInfoService are provided directly rather than by importing
  // BtcBlockhainModule, which imports this module back — a circular module reference.
  providers: [SplitWithdrawUseCase, WithdrawService, AESCipherService, ReportService, TronEnergyService, TronInfoService, EthInfoService, BtcTransactionService, BtcInfoService],
  exports: [SplitWithdrawUseCase, WithdrawService, AESCipherService],
})
export class SplitWithdrawModule {}
