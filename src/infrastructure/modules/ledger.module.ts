import { ChainCheckpoint } from '@/domain/entities/chainCheckpoint.entity'
import { Deposit } from '@/domain/entities/deposit.entity'
import { ChainCheckpointRepository } from '@/domain/repositories/chainCheckpointRepository'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

/**
 * The deposit ledger. Global because every chain's monitor use case must record a deposit
 * before any funds move.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Deposit, ChainCheckpoint])],
  providers: [DepositRepository, ChainCheckpointRepository],
  exports: [DepositRepository, ChainCheckpointRepository],
})
export class LedgerModule {}
