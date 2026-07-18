import { Chain, Currency } from '@/common/enums'
import { Deposit, DepositStatus } from '@/domain/entities/deposit.entity'
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, LessThan, Repository } from 'typeorm'

export type TClaimDepositParams = {
  chain: Chain
  txHash: string
  address: string
  outputIndex: number
  currency: Currency
  amountBaseUnits: bigint
  decimals: number
  blockHash?: string | null
  blockNumber?: bigint | null
}

@Injectable()
export class DepositRepository extends Repository<Deposit> {
  constructor(@InjectRepository(Deposit) private readonly depositRepository: Repository<Deposit>) {
    super(depositRepository.target, depositRepository.manager, depositRepository.queryRunner)
  }

  /**
   * Atomically records a newly detected deposit.
   *
   * The insert relies on the `(chain, txHash, address, outputIndex)` unique constraint and
   * `ON CONFLICT DO NOTHING`, so the check and the claim are a single statement — two
   * concurrent detections of the same deposit cannot both succeed, whether they come from
   * duplicated WebSocket listeners, overlapping polls or separate instances.
   *
   * @returns The created row, or null if this deposit was already recorded.
   */
  async claimDetected(params: TClaimDepositParams): Promise<Deposit | null> {
    const result = await this.createQueryBuilder()
      .insert()
      .into(Deposit)
      .values({
        chain: params.chain,
        txHash: params.txHash,
        address: params.address,
        outputIndex: params.outputIndex,
        currency: params.currency,
        amountBaseUnits: params.amountBaseUnits.toString(),
        decimals: params.decimals,
        status: DepositStatus.DETECTED,
        blockHash: params.blockHash ?? null,
        blockNumber: params.blockNumber?.toString() ?? null,
      })
      .orIgnore()
      .returning('*')
      .execute()

    return (result.raw as Deposit[])[0] ?? null
  }

  /**
   * Compare-and-swap DETECTED -> SWEEPING.
   *
   * This is the gate that guarantees at most one outbound transfer per deposit: a second
   * worker that reaches an already-claimed deposit gets `false` and stops.
   *
   * @returns True if this call performed the transition.
   */
  async markSweeping(id: number): Promise<boolean> {
    const result = await this.update({ id, status: DepositStatus.DETECTED }, { status: DepositStatus.SWEEPING })
    return result.affected === 1
  }

  async markSwept(id: number): Promise<void> {
    await this.update({ id }, { status: DepositStatus.SWEPT, failureReason: null })
  }

  /** DETECTED -> HELD. No funds move until an operator releases it. */
  async markHeld(id: number, reason: string): Promise<boolean> {
    const result = await this.update({ id, status: DepositStatus.DETECTED }, { status: DepositStatus.HELD, failureReason: reason.slice(0, 1000) })
    return result.affected === 1
  }

  /**
   * Total base units swept for a currency+chain since `since`, for velocity limiting.
   *
   * Counts SWEEPING as well as SWEPT: a sweep in flight has already committed the funds, so
   * excluding it would let the limit be exceeded by whatever is mid-flight.
   */
  async sumSweptSince(chain: Chain, currency: Currency, since: Date): Promise<bigint> {
    const row = await this.createQueryBuilder('deposit')
      .select('COALESCE(SUM(deposit.amountBaseUnits), 0)', 'total')
      .where('deposit.chain = :chain', { chain })
      .andWhere('deposit.currency = :currency', { currency })
      .andWhere('deposit.status IN (:...statuses)', { statuses: [DepositStatus.SWEEPING, DepositStatus.SWEPT] })
      .andWhere('deposit.updated_at >= :since', { since })
      .getRawOne<{ total: string }>()

    return BigInt(row?.total ?? '0')
  }

  async markFailed(id: number, failureReason: string): Promise<void> {
    // Postgres truncates nothing for us; keep the reason bounded so a huge RPC error body
    // cannot bloat the row.
    await this.update({ id }, { status: DepositStatus.FAILED, failureReason: failureReason.slice(0, 1000) })
  }

  async markClientNotified(id: number): Promise<void> {
    await this.update({ id }, { clientNotifiedAt: new Date() })
  }

  /**
   * Deposits the client API was never successfully told about.
   *
   * At-least-once delivery: re-notifying is safe because the payload carries the txHash, so a
   * duplicate is identifiable downstream, whereas a lost notification leaves the client API's
   * view permanently diverged from the chain.
   */
  async findUnnotified(olderThan: Date, take = 100): Promise<Deposit[]> {
    return this.find({ where: { clientNotifiedAt: IsNull(), created_at: LessThan(olderThan) }, order: { created_at: 'ASC' }, take })
  }

  /**
   * Deposits left mid-flight by a crash or a hard shutdown.
   *
   * A SWEEPING row means an outbound transfer may already have been broadcast, so these must
   * be reconciled against the chain by an operator rather than retried blindly.
   */
  async findInterrupted(): Promise<Deposit[]> {
    return this.find({ where: { status: DepositStatus.SWEEPING }, order: { created_at: 'ASC' } })
  }
}
