import { Deposit } from '@/domain/entities/deposit.entity'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

/**
 * The deposit ledger. Global because every chain's monitor use case must record a deposit
 * before any funds move.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Deposit])],
  providers: [DepositRepository],
  exports: [DepositRepository],
})
export class LedgerModule {}
