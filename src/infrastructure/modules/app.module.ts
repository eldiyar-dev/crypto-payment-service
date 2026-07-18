import { AESCipherService } from '@/common/services/aes.service'
import configuration from '@/infrastructure/config/configuration'
import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TronEnergyService } from '../blockchain/tron/tronEnergy.service'
import { DatabaseModule } from '../database/postgresql.module'
import { RedisModule } from '../redis/redise.module'
import { BtcBlockhainModule, EthBlockhainModule, TronBlockhainModule } from './blockchain'
import { BlockchainTransactionModule } from './common'
import { HealthModule } from './health.module'
import { LedgerModule } from './ledger.module'
import { SplitWithdrawModule } from './splitWithdraw.module'
import { WalletModule } from './wallet.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
    }),
    HttpModule.register({ global: true }),
    DatabaseModule,
    RedisModule,
    LedgerModule,
    TronBlockhainModule,
    EthBlockhainModule,
    BtcBlockhainModule,
    BlockchainTransactionModule,
    HealthModule,
    WalletModule,
    SplitWithdrawModule,
  ],
  controllers: [],
  providers: [AESCipherService, TronEnergyService],
  exports: [AESCipherService],
})
export class AppModule {}
