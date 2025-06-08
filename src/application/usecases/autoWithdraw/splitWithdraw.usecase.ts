import { Chain, Currency } from '@/common/enums'
import { AESCipherService } from '@/common/services/aes.service'
import { splitAmountByPercentage } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction'
import { TronEnergyService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { Injectable, Logger } from '@nestjs/common'

type TWithdrawParams = { currency: Currency; address: Wallet['address']; amount: number; chain: Chain }

@Injectable()
export class SplitWithdrawUseCase {
  private readonly logger = new Logger(SplitWithdrawUseCase.name)

  constructor(
    private readonly withdrawService: WithdrawService,
    private readonly walletRepository: WalletRepository,
    private readonly aesCipherService: AESCipherService,
    private readonly blockchainTransactionService: BlockchainTransactionService,
    private readonly reportService: ReportService,
    private readonly tronEnergyService: TronEnergyService,
  ) {}

  /**
   * Call this after deposit confirmation
   * @param currency - Currency (e.g., Currency.TRX USDT BTC ETH)
   * @param address - Source address (wallet to be emptied)
   * @param amount - Amount to withdraw (full balance)
   * @param chain - Chain (e.g., Chain.TRON, Chain.BTC, Chain.ETH)
   */
  async execute({ currency, address, amount, chain }: TWithdrawParams) {
    try {
      // Get withdrawal wallets and pie
      const withdrawData = await this.withdrawService.getWithdrawWallets(currency, address)
      const { mainAddress, mainPrivateKey, additionalAddress, pie } = withdrawData

      // Rent energy
      if (chain === Chain.TRON && currency === Currency.USDT) {
        const isRentSuccess = await this.rentEnergy(mainAddress, address, mainPrivateKey)
        if (!isRentSuccess) return
      }

      // Split amount
      const { mainAmount, additionalAmount } = splitAmountByPercentage(amount, pie)

      // Get source wallet's encrypted private key
      const wallet = await this.walletRepository.getWalletByAddress(address)
      if (!wallet) {
        this.logger.error(`Source wallet not found for ${address}`)
        return
      }

      // Withdraw to additionalAddress
      if (additionalAmount) {
        const txHash = await this.blockchainTransactionService.sendFunds({
          currency,
          toAddress: additionalAddress,
          amount: additionalAmount,
          privateKey: wallet.privateKey,
          chain,
        })
        if (!txHash) {
          void this.reportService.sendReport({ currency, address, amount: additionalAmount, message: 'Withdrawal failed additional' })
          this.logger.error(`Withdrawal failed from ${address} to ${additionalAddress} ${additionalAmount} ${currency}`)
        } else this.logger.log(`Withdraw completed from ${address} to ${additionalAddress} ${additionalAmount} ${currency} txHash: ${txHash}`)
      }

      // Withdraw to mainAddress
      if (mainAmount) {
        const txHash = await this.blockchainTransactionService.sendFunds({
          currency,
          toAddress: mainAddress,
          amount: mainAmount,
          privateKey: wallet.privateKey,
          chain,
        })
        if (!txHash) {
          void this.reportService.sendReport({ currency, address, amount: mainAmount, message: 'Withdrawal failed main' })
          this.logger.error(`Withdrawal failed from ${address} to ${mainAddress} ${mainAmount} ${currency}`)
        } else this.logger.log(`Withdraw completed from ${address} to ${mainAddress} ${mainAmount} ${currency} txHash: ${txHash}`)
      }

      this.logger.log(`Withdraw completed for ${address}`)
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address}: ${error.message}`, error)
      return
    }
  }

  private async rentEnergy(requestAddress: string, receiverAddress: string, privateKey: string) {
    const orderId = await this.tronEnergyService.buyResourceUsingPrivateKey({ buyAmount: 131_000, requestAddress, receiverAddress, privateKey })

    if (!orderId) {
      this.logger.error(`Failed to buy resource for ${receiverAddress}`)
      void this.reportService.sendReport({ currency: Currency.USDT, address: requestAddress, amount: 131_000, message: `Failed to buy resource for ${receiverAddress}` })
      return false
    }

    this.logger.log(`Rent energy for ${receiverAddress} success, orderId: ${orderId}`)
    return true
  }
}
