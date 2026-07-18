import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits, parseBaseUnits } from '@/common/utils'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

const ONE_HOUR_MS = 60 * 60 * 1000

export type TProcessDepositParams = {
  chain: Chain
  currency: Currency
  address: string
  /** Amount in base units. Exact. */
  amount: bigint
  decimals: number
  txHash: string
  /** vout index (BTC) / log index (EVM token transfers) / 0 otherwise. */
  outputIndex: number
  blockHash?: string | null
  blockNumber?: bigint | null
}

/**
 * The single entry point from detection into the money path, shared by all three chains.
 *
 * Order matters and is the point of this class:
 *
 * 1. **Record before moving money.** The deposit row is written first, so a crash at any later
 *    point leaves durable evidence that the deposit was seen and what state it reached.
 * 2. **Claim atomically.** The insert is `ON CONFLICT DO NOTHING` against the
 *    `(chain, txHash, address, outputIndex)` unique key, so a re-delivered deposit — duplicated
 *    WebSocket listener, overlapping BTC poll, restart mid-flight, or a second instance —
 *    collapses onto the existing row and does not produce a second withdrawal.
 * 3. **Transition DETECTED -> SWEEPING as a compare-and-swap**, so exactly one worker can
 *    proceed to send funds.
 * 4. **Record the outcome**, so a failed sweep is never left looking like a completed one.
 */
@Injectable()
export class ProcessDepositUseCase {
  private readonly logger = new Logger(ProcessDepositUseCase.name)

  constructor(
    private readonly depositRepository: DepositRepository,
    private readonly depositService: DepositService,
    private readonly splitWithdrawUseCase: SplitWithdrawUseCase,
    private readonly reportService: ReportService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  async execute(params: TProcessDepositParams): Promise<void> {
    const { chain, currency, address, amount, decimals, txHash, outputIndex } = params
    const label = `${chain} ${txHash}:${outputIndex} -> ${address}`

    const deposit = await this.depositRepository.claimDetected({
      chain,
      txHash,
      address,
      outputIndex,
      currency,
      amountBaseUnits: amount,
      decimals,
      blockHash: params.blockHash,
      blockNumber: params.blockNumber,
    })

    if (!deposit?.id) {
      this.logger.warn(`Duplicate deposit ignored: ${label}`)
      return
    }

    this.logger.log(`Deposit recorded #${deposit.id}: ${formatBaseUnits(amount, decimals)} ${currency} ${label}`)

    // Notification is advisory and must not gate the sweep — but it must not take the process
    // down either: an unhandled rejection here is fatal under Node's default settings.
    void this.depositService
      .notifyNewDeposit({ currency, address, amount, decimals, txHash, chain })
      .then(() => this.depositRepository.markClientNotified(deposit.id!))
      .catch((error: Error) => this.logger.error(`Failed to notify client API of deposit #${deposit.id}: ${error.message}`))

    // Bound automated outflow before any funds move. Nothing else limits it: every detected
    // deposit triggers an outbound transfer, and the destination comes from an external API.
    const hold = await this.checkSweepLimits(params)
    if (hold) {
      if (await this.depositRepository.markHeld(deposit.id, hold)) {
        this.logger.error(`Deposit #${deposit.id} HELD for manual approval: ${hold}`)
        void this.reportService
          .sendReport({
            currency,
            address,
            amount: Number(formatBaseUnits(amount, decimals)),
            amountExact: formatBaseUnits(amount, decimals),
            message: `Deposit held for manual approval: ${hold}`,
          })
          .catch((error: Error) => this.logger.error(`Failed to report held deposit #${deposit.id}: ${error.message}`))
      }
      return
    }

    const claimed = await this.depositRepository.markSweeping(deposit.id)
    if (!claimed) {
      this.logger.warn(`Deposit #${deposit.id} was already claimed by another worker; not sweeping again`)
      return
    }

    try {
      const result = await this.splitWithdrawUseCase.execute({ currency, address, amount, decimals, chain, depositId: deposit.id, txHash })

      if (result.success) {
        await this.depositRepository.markSwept(deposit.id)
        this.logger.log(`Deposit #${deposit.id} swept`)
        return
      }

      await this.depositRepository.markFailed(deposit.id, result.reason)
      this.logger.error(`Deposit #${deposit.id} failed to sweep: ${result.reason}`)
    } catch (error) {
      // The sweep should not throw, but if it does the ledger must not be left in SWEEPING —
      // that state means "an outbound transfer may be in flight" and needs operator attention.
      await this.depositRepository.markFailed(deposit.id, `Unhandled error: ${(error as Error).message}`)
      this.logger.error(`Deposit #${deposit.id} threw while sweeping: ${(error as Error).message}`)
    }
  }

  /**
   * Returns a reason to withhold this deposit from automatic sweeping, or null to proceed.
   *
   * Two independent controls, both disabled unless configured:
   * - a per-deposit ceiling, so an unusually large deposit gets human eyes before it moves;
   * - a rolling one-hour total per chain+currency, so a stream of individually-acceptable
   *   deposits cannot drain an unbounded amount — which matters because the destination
   *   addresses come from an external API this service does not control.
   */
  private async checkSweepLimits({ chain, currency, amount, decimals }: TProcessDepositParams): Promise<string | null> {
    const limits = this.configService.get<TConfiguration['sweep_limits']>('sweep_limits')

    const perDeposit = this.parseLimit(limits?.maxAutoSweep?.[currency], decimals)
    if (perDeposit !== null && amount > perDeposit) {
      return `amount ${formatBaseUnits(amount, decimals)} ${currency} exceeds the ${formatBaseUnits(perDeposit, decimals)} per-deposit auto-sweep ceiling`
    }

    const hourly = this.parseLimit(limits?.hourlyTotal?.[currency], decimals)
    if (hourly !== null) {
      const alreadySwept = await this.depositRepository.sumSweptSince(chain, currency, new Date(Date.now() - ONE_HOUR_MS))

      if (alreadySwept + amount > hourly) {
        return `hourly ${currency} outflow on ${chain} would reach ${formatBaseUnits(alreadySwept + amount, decimals)}, over the ${formatBaseUnits(hourly, decimals)} limit`
      }
    }

    return null
  }

  /** An unset or unparseable limit disables that control rather than blocking every sweep. */
  private parseLimit(value: string | undefined, decimals: number): bigint | null {
    if (!value) return null

    try {
      return parseBaseUnits(value, decimals)
    } catch {
      this.logger.error(`Ignoring malformed sweep limit "${value}"`)
      return null
    }
  }
}
