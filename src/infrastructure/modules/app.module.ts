import configuration from '@/infrastructure/config/configuration'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from '../database/postgresql.module'
import { RedisModule } from '../redis/redise.module'
import { BtcMonitorModule } from './btcMonitor.module'
import { EthMonitorModule } from './ethMonitor.module'
import { HealthModule } from './health.module'
import { TronMonitorModule } from './tronMonitor.module'

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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
