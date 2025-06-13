import { SplitWithdrawUseCase } from '@/application/usecases/autoWithdraw/splitWithdraw.usecase'
import { AESCipherService } from '@/common/services/aes.service'
import { Module } from '@nestjs/common'
import { EthInfoService } from '../blockchain/eth/ethInfo.service'
import { TronEnergyService, TronInfoService } from '../blockchain/tron'
import { ReportService } from '../clientApi/report.service'
import { WithdrawService } from '../clientApi/withdraw.service'
import { WalletModule } from './wallet.module'

@Module({
  imports: [WalletModule],
  providers: [SplitWithdrawUseCase, WithdrawService, AESCipherService, ReportService, TronEnergyService, TronInfoService, EthInfoService],
  exports: [SplitWithdrawUseCase, WithdrawService, AESCipherService],
})
export class SplitWithdrawModule {}
