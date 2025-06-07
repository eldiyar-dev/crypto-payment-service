import { SplitWithdrawUseCase } from '@/application/usecases/autoWithdraw/splitWithdraw.usecase'
import { AESCipherService } from '@/common/services/aes.service'
import { Module } from '@nestjs/common'
import { ReportService } from '../clientApi/report.service'
import { WithdrawService } from '../clientApi/withdraw.service'
import { WalletModule } from './wallet.module'

@Module({
  imports: [WalletModule],
  providers: [SplitWithdrawUseCase, WithdrawService, AESCipherService, ReportService],
  exports: [SplitWithdrawUseCase, WithdrawService, AESCipherService],
})
export class SplitWithdrawModule {}
