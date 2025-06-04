import { AESCipherService } from '@/common/services/aes.service'
import configuration from '@/infrastructure/config/configuration'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from '../database/postgresql.module'
import { RedisModule } from '../redis/redise.module'
import { BtcMonitorModule } from './btcMonitor.module'
import { EthMonitorModule } from './ethMonitor.module'
import { HealthModule } from './health.module'
import { TronMonitorModule } from './tronMonitor.module'
import { WalletModule } from './wallet.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
    }),
    DatabaseModule,
    RedisModule,
    TronMonitorModule,
    EthMonitorModule,
    BtcMonitorModule,
    HealthModule,
    WalletModule,
  ],
  controllers: [],
  providers: [AESCipherService],
  exports: [AESCipherService],
})
export class AppModule {}
