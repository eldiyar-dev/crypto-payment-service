import { Chain, Currency } from '@/common/enums'
import { AESCipherService } from '@/common/services/aes.service'
import { sleep, splitAmountByPercentage } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction'
import { TronEnergyService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { Injectable, Logger } from '@nestjs/common'

type TWithdrawParams = { currency: Currency; address: Wallet['address']; amount: number; chain: Chain }

type TWithdrawAccountParams = { fromAddress: string; fromAddressPrivateKey: string; toAddress: string; mainPrivateKey: string; amount: number; currency: Currency; chain: Chain }

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
        const remainingEnergy = await this.tronEnergyService.getAccountResourceEnergy(address)
        this.logger.debug(`Remaining energy ${address} ${remainingEnergy}`)

        const isRentSuccess = await this.rentEnergy(mainAddress, address, mainPrivateKey)
        if (!isRentSuccess) return
        const remainingEnergy2 = await this.tronEnergyService.getAccountResourceEnergy(address)
        this.logger.debug(`Remaining energy ${address} ${remainingEnergy2}`)

        await sleep(5_000)
        const remainingEnergy3 = await this.tronEnergyService.getAccountResourceEnergy(address)
        this.logger.debug(`Remaining energy ${address} ${remainingEnergy3}`)

        void sleep(5_000).then(async () => {
          const remainingEnergy = await this.tronEnergyService.getAccountResourceEnergy(address)
          this.logger.debug(`Remaining energy ${address} ${remainingEnergy}`)
        })
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
        await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey: wallet.privateKey,
          toAddress: additionalAddress,
          mainPrivateKey,
          amount: additionalAmount,
          currency,
          chain,
        })
      }

      // Withdraw to mainAddress
      if (mainAmount) {
        await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey: wallet.privateKey,
          toAddress: mainAddress,
          mainPrivateKey,
          amount: mainAmount,
          currency,
          chain,
        })
      }

      this.logger.log(`Withdraw completed for ${address}`)
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address}: ${error.message}`, error)
      return
    }
  }

  private async withdrawAccount({ fromAddress, toAddress, amount, fromAddressPrivateKey, mainPrivateKey, currency, chain }: TWithdrawAccountParams) {
    const withdrawAccount = () => this.blockchainTransactionService.sendFunds({ currency, toAddress, amount, privateKey: fromAddressPrivateKey, chain })

    const reportLog = () => {
      void this.reportService.sendReport({ currency, address: fromAddress, amount, message: 'Withdrawal failed' })
      this.logger.error(`Withdrawal failed from ${fromAddress} to ${toAddress} ${amount} ${currency}`)
      return false
    }

    const txHash = await withdrawAccount()
    if (txHash) {
      this.logger.log(`Withdraw completed from ${fromAddress} to ${toAddress} ${amount} ${currency} txHash: ${txHash}`)
      return true
    }

    // Send 0.5 TRX for fee if account resource insufficient error
    const isSendFeeSuccess = await this.sendHalfTrxForFee(fromAddress, mainPrivateKey)
    if (!isSendFeeSuccess) return reportLog()

    const txHash2 = await withdrawAccount()
    if (!txHash2) return reportLog()

    this.logger.log(`Withdraw completed from ${fromAddress} to ${toAddress} ${amount} ${currency} txHash: ${txHash2}`)
    return true
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

  /**
   * Send 0.5 TRX for fee
   * @param toAddress - Address to send the TRX to
   * @param privateKey - Private key of the wallet to send the TRX from
   * @returns True if the TRX was sent successfully, false otherwise
   */
  private async sendHalfTrxForFee(toAddress: string, privateKey: string) {
    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.TRX,
      toAddress,
      amount: 1, // 1 - 0.5 = 0.5 TRX for fee
      privateKey,
      chain: Chain.TRON,
    })

    if (!txHash) {
      void this.reportService.sendReport({ currency: Currency.TRX, address: toAddress, amount: 0.5, message: 'Fail send 0.5 TRX for fee' })
      this.logger.error(`Fail send 0.5 TRX for fee to ${toAddress}`)
      return false
    }

    this.logger.log(`Send 0.5 TRX for fee to ${toAddress} txHash: ${txHash}`)
    return true
  }
}
