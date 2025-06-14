import { Chain, Currency } from '@/common/enums'
import { AESCipherService } from '@/common/services/aes.service'
import { generateUniqueAmount, sleep, splitAmountByPercentage } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthInfoService } from '@/infrastructure/blockchain/eth/ethInfo.service'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction'
import { TronEnergyService, TronInfoService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { Injectable, Logger } from '@nestjs/common'

type TWithdrawParams = { currency: Currency; address: Wallet['address']; amount: number; chain: Chain }

type TWithdrawAccountParams = {
  fromAddress: string
  fromAddressPrivateKey: string
  toAddress: string
  mainPrivateKey: string
  amount: number
  currency: Currency
  chain: Chain
  nonce?: number
}

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
    private readonly tronInfoService: TronInfoService,
    private readonly ethInfoService: EthInfoService,
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
      const withdrawData = await this.withdrawService.getWithdrawWallets(chain, currency, address)
      if (!withdrawData) {
        this.logger.error(`Failed to get withdrawal wallets for ${address}`)
        void this.reportService.sendReport({ currency, address, amount, message: `Failed to get withdrawal wallets for ${address}` })
        return
      }

      const { mainAddress, mainPrivateKey, additionalAddress, pie } = withdrawData

      // Rent energy
      if (chain === Chain.TRON && currency === Currency.USDT) {
        const orderId = await this.rentEnergy(address, mainPrivateKey)
        if (!orderId) return
        this.logger.log(`Successfully rented energy for ${address} orderId: ${orderId}`)

        // Wait for 2 seconds to ensure the energy is rented
        await sleep(2_000)

        // Debug remaining energy
        void this.tronEnergyService.getAccountResourceEnergy(address).then((energy) => this.logger.debug(`Remaining energy ${address} ${energy}`))
      }

      // Split amount
      const { mainAmount, additionalAmount } = splitAmountByPercentage(amount, pie)

      // Get source wallet's encrypted private key
      const wallet = await this.walletRepository.getWalletByAddress(address)
      if (!wallet) {
        this.logger.error(`Source wallet not found for ${address}`)
        return
      }

      const nonce = chain === Chain.ETH ? await this.ethInfoService.getNonce(address) : 0

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
          nonce,
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
          nonce: nonce + 1,
        })
      }
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address}: ${error.message}`, error)
      return
    }
  }

  private async withdrawAccount({ fromAddress, toAddress, amount, fromAddressPrivateKey, mainPrivateKey, currency, chain, nonce }: TWithdrawAccountParams) {
    const reportLog = () => {
      void this.reportService.sendReport({ currency, address: fromAddress, amount, message: 'Withdrawal failed' })
      this.logger.error(`Withdrawal failed from ${fromAddress} to ${toAddress} ${amount} ${currency}`)
      return false
    }

    const success = () => {
      this.logger.log(`Withdraw completed from ${fromAddress} to ${toAddress} ${amount} ${currency}`)
      return true
    }

    try {
      const withdrawAccount = () => this.blockchainTransactionService.sendFunds({ currency, toAddress, amount, privateKey: fromAddressPrivateKey, chain, nonce })

      const txHash = await withdrawAccount()
      if (txHash) return success()

      if (chain === Chain.TRON) {
        // Send 0.5 TRX for fee if account resource/trx insufficient error
        const isSendFeeSuccess = await this.sendTrxForFeeOrActiveAccount(fromAddress, mainPrivateKey, 0.5, 'fee')
        if (!isSendFeeSuccess) return reportLog()

        const txHash2 = await withdrawAccount()
        if (!txHash2) return reportLog()

        return success()
      }

      if (chain === Chain.ETH) {
        const txHash = await this.calculateAndSendEthForFee(fromAddress, mainPrivateKey, amount)
        if (!txHash) return reportLog()

        const txHash2 = await withdrawAccount()
        if (!txHash2) return reportLog()

        return success()
      }

      return reportLog()
    } catch {
      return reportLog()
    }
  }

  /**
   * Rent energy
   * @param receiverAddress - Address to receive the energy
   * @param fromAddressPrivateKey - Private key of the wallet to send the TRX from
   * @returns Order ID if the energy was rented successfully, null otherwise
   */
  private async rentEnergy(receiverAddress: string, fromAddressPrivateKey: string) {
    const energyAmount = 160_000
    const orderId = await this.tronEnergyService.buyResourceUsingApiKey({ buyAmount: energyAmount, receiverAddress })
    if (orderId) return orderId

    // send 0.4 TRX for active account
    const amountTRX = 0.4
    this.logger.log(`Sending ${amountTRX} TRX for active account to ${receiverAddress}`)
    const txHash = await this.sendTrxForFeeOrActiveAccount(receiverAddress, fromAddressPrivateKey, amountTRX, 'active')
    if (!txHash) {
      void this.reportService.sendReport({
        currency: Currency.USDT,
        address: receiverAddress,
        amount: amountTRX,
        message: `Failed to send ${amountTRX} TRX for active account to ${receiverAddress}`,
      })
      this.logger.error(`Failed to send ${amountTRX} TRX for active account to ${receiverAddress}`)
      return null
    }

    // Wait for tx confirmation
    const confirmedTxBlockNumber = await this.tronInfoService.waitForTronTxConfirmation(txHash)
    if (!confirmedTxBlockNumber) {
      void this.reportService.sendReport({
        currency: Currency.USDT,
        address: receiverAddress,
        amount: amountTRX,
        message: `Failed wait for tx confirmation for active account to ${receiverAddress}`,
      })
      this.logger.error(`Failed wait for tx confirmation for active account to ${receiverAddress}`)
      return null
    }
    this.logger.log(`Successfully sent ${amountTRX} TRX for active account to ${receiverAddress}`)

    // Rent energy again after tx confirmation
    const orderId2 = await this.tronEnergyService.buyResourceUsingApiKey({ buyAmount: energyAmount, receiverAddress })
    if (orderId2) return orderId2

    this.logger.error(`Failed to buy ${energyAmount} Energy for ${receiverAddress}`)
    void this.reportService.sendReport({ currency: Currency.USDT, address: receiverAddress, amount: energyAmount, message: `Failed to buy 131000 Energy for ${receiverAddress}` })
    return null
  }

  /**
   * Send TRX for fee/active account
   * @param toAddress - Address to send the TRX to
   * @param privateKey - Private key of the wallet to send the TRX from
   * @param amount - Amount of TRX to send default 0.1
   * @param type - Type of TRX to send (fee/active) default fee
   * @returns txHash if the TRX was sent successfully, false otherwise
   */
  private async sendTrxForFeeOrActiveAccount(toAddress: string, privateKey: string, amount = 0.1, type: 'fee' | 'active' = 'fee') {
    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.TRX,
      toAddress,
      amount: generateUniqueAmount(amount + 0.5), // + 0.5 TRX for fee
      privateKey,
      chain: Chain.TRON,
    })

    if (!txHash) {
      void this.reportService.sendReport({ currency: Currency.TRX, address: toAddress, amount, message: `Fail send ${amount} TRX for ${type}` })
      this.logger.error(`Fail send ${amount} TRX for ${type} to ${toAddress}`)
      return false
    }

    this.logger.log(`Send ${amount} TRX for ${type} to ${toAddress} txHash: ${txHash}`)
    return txHash
  }

  /**
   * Calculate and send ETH for fee
   * @param toAddress - Address to send the ETH to
   * @param privateKey - Private key of the wallet to send the ETH from
   * @param amountUSDT - Amount of USDT to send
   * @returns txHash if the ETH was sent successfully, false otherwise
   */
  private async calculateAndSendEthForFee(toAddress: string, privateKey: string, amountUSDT: number) {
    const gasPriceInEth = await this.ethInfoService.getGasPriceInEth(privateKey, toAddress, amountUSDT)
    if (!gasPriceInEth) return false

    this.logger.log(`Gas price in ETH for fee: ${gasPriceInEth}`)

    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.ETH,
      toAddress,
      amount: gasPriceInEth,
      privateKey,
      chain: Chain.ETH,
    })
    if (!txHash) {
      this.logger.error(`Failed to send ${gasPriceInEth} ETH for fee to ${toAddress}`)
      return false
    }

    this.logger.log(`Send ${gasPriceInEth} ETH for fee to ${toAddress} txHash: ${txHash}`)
    return txHash
  }
}
