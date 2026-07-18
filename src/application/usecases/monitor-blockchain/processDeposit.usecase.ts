import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits } from '@/common/utils'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { Injectable, Logger } from '@nestjs/common'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

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
      .catch((error: Error) => this.logger.error(`Failed to notify client API of deposit #${deposit.id}: ${error.message}`))

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
}
