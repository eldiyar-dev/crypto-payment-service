import { Chain } from '@/common/enums'
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * How far each chain's scanner has progressed, held durably.
 *
 * TRON previously reset `lastCheckedBlock` to the current block on every boot, so every
 * deposit that arrived during downtime was skipped permanently; ETH had no checkpoint at all
 * and subscribed only to new blocks, making downtime an unrecoverable gap. BTC did persist
 * progress, but into Redis — which runs with `allkeys-lru`, so losing that key silently reset
 * the scanner to the chain tip with exactly the same effect.
 *
 * Postgres is the right home for this: it is the durable store, and it is not evictable.
 */
@Entity()
export class ChainCheckpoint {
  @PrimaryColumn({ type: String, enum: Chain })
  chain: Chain

  /** Highest block fully scanned. Stored as a string: block heights outgrow int4. */
  @Column({ type: 'bigint' })
  lastScannedBlock: string

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', precision: 0 })
  updated_at?: Date
}
