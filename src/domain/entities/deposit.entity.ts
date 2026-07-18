import { Chain, Currency } from '@/common/enums'
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

/**
 * Lifecycle of a detected deposit.
 *
 * The transition that matters for money safety is DETECTED -> SWEEPING: it is a
 * compare-and-swap, so exactly one worker can move a deposit into the sweeping state and
 * therefore exactly one outbound transfer is attempted per deposit.
 */
export enum DepositStatus {
  /** Seen on-chain and recorded. No funds have moved. */
  DETECTED = 'DETECTED',
  /** Claimed by a worker; an outbound transfer may have been broadcast. */
  SWEEPING = 'SWEEPING',
  /** Both split legs completed. */
  SWEPT = 'SWEPT',
  /** The sweep failed; see failureReason. Requires operator attention. */
  FAILED = 'FAILED',
}

/**
 * Durable record of an incoming deposit.
 *
 * Before this existed there was no local evidence that a deposit was ever seen, swept or
 * failed — recovery after a crash depended entirely on the external client API's state plus
 * manual chain inspection. The row is written *before* any outbound transfer, so a crash at
 * any point leaves a recoverable record.
 *
 * The unique key doubles as the idempotency key: re-delivery from a duplicated WebSocket
 * listener, an overlapping BTC poll, a restart mid-flight or a second instance all collapse
 * onto the same row instead of producing a second withdrawal.
 */
@Unique(['chain', 'txHash', 'address', 'outputIndex'])
@Index(['status'])
@Entity()
export class Deposit {
  @PrimaryGeneratedColumn()
  id?: number

  @Column({ type: String, enum: Chain })
  chain: Chain

  @Column({ type: String })
  txHash: string

  @Column({ type: String })
  address: string

  /**
   * Disambiguates multiple credits to the same address within one transaction:
   * the vout index on BTC, the log index on EVM token transfers, 0 otherwise.
   */
  @Column({ type: 'int', default: 0 })
  outputIndex: number

  @Column({ type: String, enum: Currency })
  currency: Currency

  /**
   * Amount in base units. Stored as an exact numeric string because a bigint does not fit a
   * JS-safe integer column and must never be narrowed to a float — numeric(78,0) covers the
   * full uint256 range.
   */
  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amountBaseUnits: string

  @Column({ type: 'int' })
  decimals: number

  @Column({ type: String, enum: DepositStatus, default: DepositStatus.DETECTED })
  status: DepositStatus

  /** Block hash at detection time, so a reorg can be detected before or after the sweep. */
  @Column({ type: String, nullable: true })
  blockHash?: string | null

  @Column({ type: 'bigint', nullable: true })
  blockNumber?: string | null

  @Column({ type: String, nullable: true })
  failureReason?: string | null

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', precision: 0 })
  created_at?: Date

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', precision: 0 })
  updated_at?: Date
}
