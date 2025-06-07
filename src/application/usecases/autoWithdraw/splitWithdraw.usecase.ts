import { Currency } from '@/common/enums'
import { AESCipherService } from '@/common/services/aes.service'
import { splitAmountByPercentage } from '@/common/utils/calculate.util'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction/transaction.service'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { Injectable, Logger } from '@nestjs/common'

type TWithdrawParams = { currency: Currency; address: Wallet['address']; amount: number; contractAddress?: string }

@Injectable()
export class SplitWithdrawUseCase {
  private readonly logger = new Logger(SplitWithdrawUseCase.name)

  constructor(
    private readonly withdrawService: WithdrawService,
    private readonly walletRepository: WalletRepository,
    private readonly aesCipherService: AESCipherService,
    private readonly blockchainTransactionService: BlockchainTransactionService,
    private readonly reportService: ReportService,
  ) {}

  /**
   * Call this after deposit confirmation
   * @param currency - Currency (e.g., Currency.TRX USDT BTC ETH)
   * @param address - Source address (wallet to be emptied)
   * @param amount - Amount to withdraw (full balance)
   * @param contractAddress - TRC20 contract address if needed
   */
  async execute({ currency, address, amount }: TWithdrawParams) {
    try {
      // Get withdrawal wallets and pie
      const withdrawData = await this.withdrawService.getWithdrawWallets(currency, address)
      const { mainAddress, additionalAddress, pie } = withdrawData

      // Split amount
      const { mainAmount, additionalAmount } = splitAmountByPercentage(amount, pie)

      // Get source wallet's encrypted private key
      const wallet = await this.walletRepository.getWalletByAddress(address)
      if (!wallet) throw new Error('Source wallet not found')

      // Withdraw to additionalAddress
      if (additionalAmount) {
        const receipt = await this.blockchainTransactionService.sendFunds({
          currency,
          toAddress: additionalAddress,
          amount: additionalAmount,
          privateKey: wallet.privateKey,
        })
        if (!receipt?.result) {
          void this.reportService.sendReport({ currency, address, amount: additionalAmount, message: 'Withdrawal failed additional' })
          this.logger.error(`Withdrawal failed from ${address} to ${additionalAddress} ${additionalAmount} ${currency}`, receipt)
        }

        this.logger.log(`Withdraw completed from ${address} to ${additionalAddress} ${additionalAmount} ${currency}`, receipt)
      }

      // Withdraw to mainAddress
      if (mainAmount) {
        const receipt = await this.blockchainTransactionService.sendFunds({
          currency,
          toAddress: mainAddress,
          amount: mainAmount,
          privateKey: wallet.privateKey,
        })
        if (!receipt?.result) {
          void this.reportService.sendReport({ currency, address, amount: mainAmount, message: 'Withdrawal failed main' })
          this.logger.error(`Withdrawal failed from ${address} to ${mainAddress} ${mainAmount} ${currency}`, receipt)
        }

        this.logger.log(`Withdraw completed from ${address} to ${mainAddress} ${mainAmount} ${currency}`, receipt)
      }

      this.logger.log(`Withdraw completed for ${address}`)
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address}: ${error.message}`)
      throw error
    }
  }
}
