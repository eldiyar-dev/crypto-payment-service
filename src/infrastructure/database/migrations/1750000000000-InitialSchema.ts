import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Baseline schema: `wallet` (pre-existing), plus `deposit` and `chain_checkpoint` introduced
 * by the deposit-ledger and checkpoint work.
 *
 * Written to be **idempotent** (`IF NOT EXISTS` throughout) because it has to run cleanly
 * against three different starting points: a fresh database, a database previously managed by
 * `synchronize: true` that already has `wallet`, and one that has already been through this
 * migration.
 *
 * Column names are unquoted-sensitive: TypeORM's default naming strategy preserves the entity
 * property names, so the camelCase columns must be double-quoted to survive Postgres folding.
 */
export class InitialSchema1750000000000 implements MigrationInterface {
  name = 'InitialSchema1750000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet" (
        "id" SERIAL NOT NULL,
        "address" character varying NOT NULL,
        "privateKey" character varying NOT NULL,
        "chain" character varying NOT NULL,
        "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMP(0) DEFAULT NULL,
        CONSTRAINT "PK_wallet_id" PRIMARY KEY ("id")
      )
    `)

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wallet_address_chain" ON "wallet" ("address", "chain")`)
    // Without this, the boot-time seed filtering on chain alone is a sequential scan: `chain`
    // is the second column of the unique index above and cannot be used on its own.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_wallet_chain" ON "wallet" ("chain")`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deposit" (
        "id" SERIAL NOT NULL,
        "chain" character varying NOT NULL,
        "txHash" character varying NOT NULL,
        "address" character varying NOT NULL,
        "outputIndex" integer NOT NULL DEFAULT 0,
        "currency" character varying NOT NULL,
        "amountBaseUnits" numeric(78,0) NOT NULL,
        "decimals" integer NOT NULL,
        "status" character varying NOT NULL DEFAULT 'DETECTED',
        "blockHash" character varying,
        "blockNumber" bigint,
        "failureReason" character varying,
        "clientNotifiedAt" TIMESTAMP,
        "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_deposit_id" PRIMARY KEY ("id")
      )
    `)

    // The idempotency key. This constraint is what makes a re-delivered deposit a no-op rather
    // than a second withdrawal, so it is load-bearing, not merely a data-hygiene index.
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_deposit_chain_tx_address_output" ON "deposit" ("chain", "txHash", "address", "outputIndex")`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_deposit_status" ON "deposit" ("status")`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chain_checkpoint" (
        "chain" character varying NOT NULL,
        "lastScannedBlock" bigint NOT NULL,
        "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_chain_checkpoint_chain" PRIMARY KEY ("chain")
      )
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `wallet` is deliberately NOT dropped: it holds custodial key material and predates this
    // migration. Rolling back the ledger must never destroy the wallets.
    await queryRunner.query(`DROP TABLE IF EXISTS "chain_checkpoint"`)
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_deposit_status"`)
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_deposit_chain_tx_address_output"`)
    await queryRunner.query(`DROP TABLE IF EXISTS "deposit"`)
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_chain"`)
  }
}
