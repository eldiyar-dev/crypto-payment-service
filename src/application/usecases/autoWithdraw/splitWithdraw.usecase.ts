import { Chain, Currency } from '@/common/enums'
import { EvmNetwork } from '@/common/interfaces'
import { AESCipherService } from '@/common/services/aes.service'
import {
  ETH_DECIMALS,
  fireAndForget,
  formatBaseUnits,
  generateUniqueAmount,
  isEvmNetwork,
  parseBaseUnits,
  sleep,
  splitAmountByPercentage,
  toDisplayNumber,
  TRX_DECIMALS,
} from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcTransactionService } from '@/infrastructure/blockchain/btc'
import { EthInfoService } from '@/infrastructure/blockchain/eth/ethInfo.service'
import { BlockchainTransactionService } from '@/infrastructure/blockchain/transaction'
import { TronEnergyService, TronInfoService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { WithdrawService } from '@/infrastructure/clientApi/withdraw.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type TWithdrawParams = {
  currency: Currency
  address: Wallet['address']
  /** Deposited amount in base units. Exact. */
  amount: bigint
  /** Decimal places for `amount`. */
  decimals: number
  chain: Chain
  /**
   * Identity of the deposit being swept. Carried so that every log line and every failure
   * report can be tied back to a ledger row — without it a failed sweep could not be matched
   * to the deposit that caused it, which is what makes the ledger actionable.
   */
  depositId: number
  txHash: string
}

/** Outcome of a sweep, recorded against the deposit ledger by the caller. */
export type TWithdrawResult = { success: true } | { success: false; reason: string }

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

/** Up to 0.01 TRX of dust, so repeated fee transfers are distinguishable on-chain. */
const TRON_FEE_DUST_SUN = 10_000n
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
    private readonly btcTransactionService: BtcTransactionService,
    private readonly reportService: ReportService,
    private readonly tronEnergyService: TronEnergyService,
    private readonly tronInfoService: TronInfoService,
    private readonly ethInfoService: EthInfoService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  /**
   * Call this after deposit confirmation.
   *
   * @param currency - Currency (e.g., Currency.TRX USDT BTC ETH)
   * @param address - Source address (wallet to be emptied)
   * @param amount - Amount to withdraw, in base units
   * @param decimals - Decimal places for `amount`
   * @param chain - Chain (e.g., Chain.TRON, Chain.BTC, Chain.ETH)
   * @returns A result describing whether every attempted leg completed. The caller records
   * this on the deposit ledger, so "failed" must never be reported as "swept".
   */
  async execute({ currency, address, amount, decimals, chain, depositId, txHash }: TWithdrawParams): Promise<TWithdrawResult> {
    const ref = `deposit #${depositId} (${chain} ${txHash})`

    try {
      // Get withdrawal wallets and pie
      const withdrawData = await this.withdrawService.getWithdrawWallets(chain, address)
      if (!withdrawData) {
        this.logger.error(`Failed to get withdrawal wallets for ${address} ${ref}`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Failed to get withdrawal wallets for ${address}` })
        return { success: false, reason: 'Failed to get withdrawal wallets' }
      }

      const { mainAddress, mainPrivateKey, additionalAddress, pie } = withdrawData

      // Defence in depth: WithdrawService already rejects an out-of-range pie at the boundary,
      // and splitAmountByPercentage throws on one. Checking here too means the failure is
      // reported with deposit context rather than surfacing as a bare exception.
      //
      // Unvalidated, `undefined` made both legs NaN — and because `if (amount)` is falsy for
      // NaN, the funds silently never moved and no report was sent at all. `pie > 100` made
      // the main leg negative, which is truthy, so a send was attempted with a negative amount.
      if (!Number.isFinite(pie) || pie < 0 || pie > 100) {
        this.logger.error(`Invalid split percentage for ${address} ${ref}: ${String(pie)}`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Invalid split percentage received: ${String(pie)}` })
        return { success: false, reason: `Invalid split percentage: ${String(pie)}` }
      }

      // Rent energy
      if (chain === Chain.TRON && currency === Currency.USDT) {
        const orderId = await this.rentEnergy(address, mainPrivateKey)
        if (!orderId) return { success: false, reason: 'Failed to rent TRON energy' }
        this.logger.log(`Successfully rented energy for ${address} orderId: ${orderId}`)

        // Wait for 2 seconds to ensure the energy is rented
        await sleep(2_000)

        // Debug remaining energy
        // A debug log line must not be able to take the service down: getAccountResourceEnergy
        // performs an RPC call and the .then() had no rejection handler.
        fireAndForget(
          this.tronEnergyService.getAccountResourceEnergy(address).then((energy) => this.logger.debug(`Remaining energy ${address} ${energy}`)),
          this.logger,
          `Reading remaining energy for ${address}`,
        )
      }

      // Split amount. splitAmountByPercentage throws on a percentage outside [0, 100] rather
      // than producing a NaN or negative leg, so a bad `pie` aborts here and is reported.
      const { mainAmount, additionalAmount } = splitAmountByPercentage(amount, pie)

      // Conservation invariant: the two legs must account for the deposit exactly. Cheap to
      // check and the failure mode it guards against — value silently disappearing into an
      // unallocated rounding residue — is invisible on-chain until reconciliation.
      if (mainAmount + additionalAmount !== amount) {
        this.logger.error(`Split does not conserve value for ${address} ${ref}: ${mainAmount} + ${additionalAmount} !== ${amount}`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Split does not conserve value for ${address}` })
        return { success: false, reason: 'Split does not conserve value' }
      }

      // Get source wallet's encrypted private key
      const wallet = await this.walletRepository.getWalletByAddress(address)
      if (!wallet) {
        this.logger.error(`Source wallet not found for ${address} ${ref}`)
        return { success: false, reason: 'Source wallet not found' }
      }

      // Decrypt in memory at send time — key material is never held decrypted at rest.
      const fromAddressPrivateKey = this.aesCipherService.decryptPrivateKey(wallet.privateKey, address)
      if (!fromAddressPrivateKey) {
        this.logger.error(`Unable to resolve private key for ${address} ${ref}; aborting withdrawal`)
        void this.reportService.sendReport({ currency, address, ...this.reportAmount(amount, decimals), message: `Unable to resolve private key for ${address}` })
        return { success: false, reason: 'Unable to resolve private key' }
      }

      // On Bitcoin the two legs MUST share one transaction. Sent sequentially, leg 1 spends
      // every UTXO and leg 2 either finds nothing (change still unconfirmed) or re-spends the
      // same now-spent UTXOs as a conflicting double-spend.
      if (chain === Chain.BTC) {
        return await this.withdrawBtcSplit({ fromAddress: address, fromAddressPrivateKey, mainAddress, additionalAddress, mainAmount, additionalAmount, decimals, currency })
      }

      // Withdraw to additionalAddress
      if (additionalAmount > 0n) {
        const additionalSent = await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey,
          toAddress: additionalAddress,
          mainPrivateKey,
          amount: additionalAmount,
          decimals,
          currency,
          chain,
        })

        // Stop here rather than attempting leg 2. The return value used to be discarded, so a
        // failed first leg did not prevent the second — and the wallet was left half-swept
        // with no record of which leg had landed.
        if (!additionalSent) return { success: false, reason: 'Additional leg failed; main leg not attempted' }
      }

      // Withdraw to mainAddress
      if (mainAmount > 0n) {
        const mainSent = await this.withdrawAccount({
          fromAddress: address,
          fromAddressPrivateKey,
          toAddress: mainAddress,
          mainPrivateKey,
          amount: mainAmount,
          decimals,
          currency,
          chain,
        })

        if (!mainSent) {
          // Leg 1 has already landed, so this is a genuinely half-swept wallet: it needs
          // operator attention, not a silent 'failed'.
          const partial = additionalAmount > 0n
          return { success: false, reason: partial ? 'PARTIAL SWEEP: additional leg sent, main leg failed' : 'Main leg failed' }
        }
      }

      return { success: true }
    } catch (error) {
      this.logger.error(`Withdraw failed for ${address} ${ref}: ${error.message}`, error)
      return { success: false, reason: `Withdraw threw: ${(error as Error).message}` }
    }
  }

  /**
   * Sweeps both legs of a Bitcoin split in a single transaction.
   *
   * Atomic by construction: either both destinations are paid or neither is, so there is no
   * half-swept state to reconcile. There is no fee top-up path on BTC, so a failure here is
   * terminal for this deposit and is reported.
   */
  private async withdrawBtcSplit({
    fromAddress,
    fromAddressPrivateKey,
    mainAddress,
    additionalAddress,
    mainAmount,
    additionalAmount,
    decimals,
    currency,
  }: {
    fromAddress: string
    fromAddressPrivateKey: string
    mainAddress: string
    additionalAddress: string
    mainAmount: bigint
    additionalAmount: bigint
    decimals: number
    currency: Currency
  }): Promise<TWithdrawResult> {
    const outputs = [
      { toAddress: additionalAddress, amount: additionalAmount },
      { toAddress: mainAddress, amount: mainAmount },
    ].filter((output) => output.amount > 0n)

    if (!outputs.length) return { success: true }

    const txHash = await this.btcTransactionService.sendBTCToMany({ outputs, privateKey: fromAddressPrivateKey })
    if (!txHash) {
      const total = mainAmount + additionalAmount
      void this.reportService.sendReport({ currency, address: fromAddress, ...this.reportAmount(total, decimals), message: 'BTC split withdrawal failed' })
      this.logger.error(`BTC split withdrawal failed from ${fromAddress}`)
      return { success: false, reason: 'BTC split withdrawal failed' }
    }

    this.logger.log(`BTC split withdrawal complete from ${fromAddress} txHash: ${txHash}`)
    return { success: true }
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
        const txHash = await this.calculateAndSendEthForFee(fromAddress, toAddress, mainPrivateKey, amount, currency, chain)
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

    // sendTRX now waits for on-chain confirmation itself, so a returned hash already means the
    // account-activation transfer landed — no second wait needed here.
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
    // sendTRX now transfers exactly what it is given, so the recipient is credited `amount`.
    const amountSun = parseBaseUnits(amount, TRX_DECIMALS)

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
   * @param sourceAddress - The wallet that will perform the withdrawal, and receives the gas
   * @param destinationAddress - Where the withdrawal is going; part of the gas estimate
   * @param privateKey - Private key of the fee wallet funding the gas
   * @param amount - Amount the source wallet is about to send, in base units
   * @param currency - Currency (e.g., Currency.USDT, Currency.ETH)
   * @param evmNetwork - EVM network
   * @returns txHash if the gas was sent successfully, false otherwise
   */
  private async calculateAndSendEthForFee(sourceAddress: string, destinationAddress: string, privateKey: string, amount: bigint, currency: Currency, evmNetwork: EvmNetwork) {
    // Estimate the transfer that actually needs the gas: source -> destination. This used to
    // estimate a transfer FROM the fee wallet TO the source address — the opposite direction,
    // from the wrong account. ERC-20 gas differs materially by direction (an SSTORE to a zero
    // balance is ~20k gas versus ~5k to a non-zero one), so the top-up could under-fund the
    // withdrawal and the single retry would then fail too.
    const estimated =
      currency === Currency.USDT
        ? await this.ethInfoService.getUSDTGasCostInWei(sourceAddress, destinationAddress, amount, evmNetwork)
        : await this.ethInfoService.getEthTransferGasCostInWei(sourceAddress, destinationAddress, amount, evmNetwork)

    // The fallback is per-chain: a single hardcoded ETH-shaped constant is meaningless on BSC,
    // Polygon, Avalanche or Fantom, whose native token is not ETH.
    const gasCostInWei = estimated ?? parseBaseUnits(this.configService.get(`evmNetworks.${evmNetwork}.nativeGasFallback`, { infer: true })!, ETH_DECIMALS)
    if (estimated === null) this.logger.warn(`Gas estimation failed for ${sourceAddress} on ${evmNetwork}; using the configured fallback`)

    this.logger.log(`Gas cost for fee: ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} network: ${evmNetwork}`)
    const txHash = await this.blockchainTransactionService.sendFunds({
      currency: Currency.ETH,
      toAddress: sourceAddress,
      amount: gasCostInWei + EVM_GAS_BUFFER_WEI,
      privateKey,
      chain: evmNetwork,
    })
    if (!txHash) {
      this.logger.error(`Failed to send ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} gas to ${sourceAddress} network: ${evmNetwork}`)
      return false
    }

    await this.redisService.addFeeTransactionHash(txHash)
    this.logger.log(`Sent ${formatBaseUnits(gasCostInWei, ETH_DECIMALS)} gas to ${sourceAddress} network: ${evmNetwork} txHash: ${txHash}`)
    return txHash
  }
}
