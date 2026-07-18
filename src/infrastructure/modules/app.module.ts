import { AESCipherService } from '@/common/services/aes.service'
import configuration, { TConfiguration } from '@/infrastructure/config/configuration'
import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { TronEnergyService } from '../blockchain/tron/tronEnergy.service'
import { DatabaseModule } from '../database/postgresql.module'
import { RedisModule } from '../redis/redise.module'
import { BtcBlockhainModule, EthBlockhainModule, TronBlockhainModule } from './blockchain'
import { BlockchainTransactionModule } from './common'
import { HealthModule } from './health.module'
import { LedgerModule } from './ledger.module'
import { ReconciliationModule } from './reconciliation.module'
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
    // The `throttler` config existed but ThrottlerModule was never imported and no APP_GUARD
    // was registered, so nothing was ever rate limited.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<TConfiguration>) => configService.get('throttler', { infer: true })!,
    }),
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
    ReconciliationModule,
  ],
  controllers: [],
  providers: [AESCipherService, TronEnergyService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [AESCipherService],
})
export class AppModule {}
