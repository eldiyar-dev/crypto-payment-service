import { Chain, Currency } from '@/common/enums'
import { EvmNetwork } from '@/common/interfaces'
import { AESCipherService } from '@/common/services/aes.service'
import { ETH_DECIMALS, formatBaseUnits, generateUniqueAmount, isEvmNetwork, parseBaseUnits, sleep, splitAmountByPercentage, toDisplayNumber, TRX_DECIMALS } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthInfoService } from '@/infrastructure/blockchain/eth/ethInfo.service'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction'
import { TronEnergyService, TronInfoService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'

type TWithdrawParams = {
  currency: Currency
  address: Wallet['address']
  /** Deposited amount in base units. Exact. */
  amount: bigint
  /** Decimal places for `amount`. */
  decimals: number
  chain: Chain
}

type TWithdrawAccountParams = {
  fromAddress: string
  fromAddressPrivateKey: string
  toAddress: string
  mainPrivateKey: string
  /** Amount to send in base units. Exact. */
  amount: bigint
  /** Decimal places for `amount`. */
  decimals: number
  currency: Currency
  chain: Chain
  nonce?: number
}

/** TronTransactionService.sendTRX deducts this reserve from every send. */
const TRON_FEE_RESERVE_SUN = 500_000n
/** Up to 0.01 TRX of dust, so repeated fee transfers are distinguishable on-chain. */
const TRON_FEE_DUST_SUN = 10_000n
/** Ceiling used when gas estimation fails, in wei (0.0007 ETH). */
const EVM_GAS_FALLBACK_WEI = 700_000_000_000_000n
/** Headroom added on top of the estimate, in wei (0.0001 ETH). */
const EVM_GAS_BUFFER_WEI = 100_000_000_000_000n

@Injectable()
export class SplitWithdrawUseCase {
  private readonly logger = new Logger(SplitWithdrawUseCase.name)

  /**
   * Builds the amount fields for a client-API report: a lossy display number for wire
   * compatibility, plus the exact decimal string.
   */
  private reportAmount(amount: bigint, decimals: number) {
    return { amount: toDisplayNumber(amount, decimals), amountExact: formatBaseUnits(amount, decimals) }
  }

  constructor(
    private readonly withdrawService: WithdrawService,
    private readonly walletRepository: WalletRepository,
    private readonly aesCipherService: AESCipherService,
    private readonly blockchainTransactionService: BlockchainTransactionService,
    private readonly reportService: ReportService,
    private readonly tronEnergyService: TronEnergyService,
    private readonly tronInfoService: TronInfoService,
    private readonly ethInfoService: EthInfoService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Call this after deposit confirmation
   * @param currency - Currency (e.g., Currency.TRX USDT BTC ETH)
   * @param address - Source address (wallet to be emptied)
   * @param amount - Amount to withdraw (full balance)
   * @param chain - Chain (e.g., Chain.TRON, Chain.BTC, Chain.ETH)
   */
  async execute({ currency, address, amount, decimals, chain }: TWithdrawParams) {
    try {
      // Get withdrawal wallets and pie
      const withdrawData = await this.withdrawService.getWithdrawWallets(chain, address)
      if (!withdrawData) {
        this.logger.error(`Failed to get withdrawal wallets for ${address}`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Failed to get withdrawal wallets for ${address}` })
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

      // Split amount. splitAmountByPercentage throws on a percentage outside [0, 100] rather
      // than producing a NaN or negative leg, so a bad `pie` aborts here and is reported.
      const { mainAmount, additionalAmount } = splitAmountByPercentage(amount, pie)

      // Conservation invariant: the two legs must account for the deposit exactly. Cheap to
      // check and the failure mode it guards against — value silently disappearing into an
      // unallocated rounding residue — is invisible on-chain until reconciliation.
      if (mainAmount + additionalAmount !== amount) {
        this.logger.error(`Split does not conserve value for ${address}: ${mainAmount} + ${additionalAmount} !== ${amount}`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Split does not conserve value for ${address}` })
        return
      }

      // Get source wallet's encrypted private key
      const wallet = await this.walletRepository.getWalletByAddress(address)
      if (!wallet) {
        this.logger.error(`Source wallet not found for ${address}`)
        return
      }

      // Decrypt in memory at send time — key material is never held decrypted at rest.
      const fromAddressPrivateKey = this.aesCipherService.decryptPrivateKey(wallet.privateKey, address)
      if (!fromAddressPrivateKey) {
        this.logger.error(`Unable to resolve private key for ${address}; aborting withdrawal`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Unable to resolve private key for ${address}` })
        return
      }

      // Withdraw to additionalAddress
      if (additionalAmount > 0n) {
        await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey,
          toAddress: additionalAddress,
          mainPrivateKey,
          amount: additionalAmount,
          decimals,
          currency,
          chain,
        })
      }

      // Withdraw to mainAddress
      if (mainAmount > 0n) {
        await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey,
          toAddress: mainAddress,
          mainPrivateKey,
          amount: mainAmount,
          decimals,
          currency,
          chain,
        })
      }
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address}: ${error.message}`, error)
      return
    }
  }

  private async withdrawAccount({ fromAddress, toAddress, amount, decimals, fromAddressPrivateKey, mainPrivateKey, currency, chain, nonce }: TWithdrawAccountParams) {
    const reportLog = () => {
      void this.reportService.sendReport({ currency, address: fromAddress, ...this.reportAmount(amount, decimals), message: 'Withdrawal failed' })
      this.logger.error(`Withdrawal failed from ${fromAddress} to ${toAddress} ${formatBaseUnits(amount, decimals)} ${currency}`)
      return false
    }

    const success = () => {
      this.logger.log(`Withdraw completed from ${fromAddress} to ${toAddress} ${formatBaseUnits(amount, decimals)} ${currency}`)
      return true
    }

    try {
      const withdrawAccount = () => this.blockchainTransactionService.sendFunds({ currency, toAddress, amount, privateKey: fromAddressPrivateKey, chain, nonce })

      const txHash = await withdrawAccount()
      if (txHash) return success()

      if (chain === Chain.TRON) {
        // Send 0.5 TRX for fee if account resource/trx insufficient error
        const isSendFeeSuccess = await this.sendTrxForFeeOrActiveAccount(fromAddress, mainPrivateKey, '0.5', 'fee')
        if (!isSendFeeSuccess) return reportLog()

        const txHash2 = await withdrawAccount()
        if (!txHash2) return reportLog()

        return success()
      }

      if (isEvmNetwork(chain)) {
        const txHash = await this.calculateAndSendEthForFee(fromAddress, mainPrivateKey, amount, currency, chain)
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
    const amountTRX = '0.4'
    this.logger.log(`Sending ${amountTRX} TRX for active account to ${receiverAddress}`)
    const txHash = await this.sendTrxForFeeOrActiveAccount(receiverAddress, fromAddressPrivateKey, amountTRX, 'active')
    if (!txHash) {
      void this.reportService.sendReport({
        currency: Currency.USDT,
        address: receiverAddress,
        amount: Number(amountTRX),
        amountExact: amountTRX,
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
        amount: Number(amountTRX),
        amountExact: amountTRX,
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
   * @param amount - Amount of TRX to send, as a decimal string, default '0.1'
   * @param type - Type of TRX to send (fee/active) default fee
   * @returns txHash if the TRX was sent successfully, false otherwise
   */
  private async sendTrxForFeeOrActiveAccount(toAddress: string, privateKey: string, amount = '0.1', type: 'fee' | 'active' = 'fee') {
    // TronTransactionService.sendTRX deducts a 0.5 TRX fee reserve from what it is given, so the
    // reserve is added back here to make the amount the recipient is credited match `amount`.
    const amountSun = parseBaseUnits(amount, TRX_DECIMALS) + TRON_FEE_RESERVE_SUN

    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.TRX,
      toAddress,
      amount: generateUniqueAmount(amountSun, TRON_FEE_DUST_SUN),
      privateKey,
      chain: Chain.TRON,
    })

    if (!txHash) {
      void this.reportService.sendReport({
        currency: Currency.TRX,
        address: toAddress,
        amount: Number(amount),
        amountExact: amount,
        message: `Fail send ${amount} TRX for ${type}`,
      })
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
   * @param amount - Amount the source wallet is about to send, in base units
   * @param currency - Currency (e.g., Currency.USDT, Currency.ETH)
   * @param evmNetwork - EVM network
   * @returns txHash if the ETH was sent successfully, false otherwise
   */
  private async calculateAndSendEthForFee(toAddress: string, privateKey: string, amount: bigint, currency: Currency, evmNetwork: EvmNetwork) {
    // If the estimate is unavailable, fall back to a ceiling.
    const gasCostInWei =
      currency === Currency.USDT
        ? ((await this.ethInfoService.getUSDTGasCostInWei(privateKey, toAddress, amount, evmNetwork)) ?? EVM_GAS_FALLBACK_WEI)
        : ((await this.ethInfoService.getEthTransferGasCostInWei(privateKey, toAddress, amount, evmNetwork)) ?? EVM_GAS_FALLBACK_WEI)

    this.logger.log(`Gas cost for fee: ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} network: ${evmNetwork}`)
    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.ETH,
      toAddress,
      amount: gasCostInWei + EVM_GAS_BUFFER_WEI,
      privateKey,
      chain: evmNetwork,
    })
    if (!txHash) {
      this.logger.error(`Failed to send ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} ETH for fee to ${toAddress} network: ${evmNetwork}`)
      return false
    }

    await this.redisService.addFeeTransactionHash(txHash)
    this.logger.log(`Send ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} ETH for fee to ${toAddress} network: ${evmNetwork} txHash: ${txHash}`)
    return txHash
  }
}
