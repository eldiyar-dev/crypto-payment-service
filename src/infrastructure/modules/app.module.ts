import { AESCipherService } from '@/common/services/aes.service'
import configuration from '@/infrastructure/config/configuration'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from '../database/postgresql.module'
import { BtcBlockhainModule, EthBlockhainModule, TronBlockhainModule } from './blockchain'
import { BlockchainTransactionModule } from './common'
import { HealthModule } from './health.module'
import { SplitWithdrawModule } from './splitWithdraw.module'
import { WalletModule } from './wallet.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
    }),
    DatabaseModule,
    // RedisModule,
    TronBlockhainModule,
    EthBlockhainModule,
    BtcBlockhainModule,
    BlockchainTransactionModule,
    HealthModule,
    WalletModule,
    SplitWithdrawModule,
  ],
  controllers: [],
  providers: [AESCipherService],
  exports: [AESCipherService],
})
export class AppModule {}
