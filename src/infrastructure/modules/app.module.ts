import configuration from '@/infrastructure/config/configuration'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { BtcMonitorModule } from './btcMonitor.module'
import { HealthModule } from './health.module'
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      cache: true,
    }),
    // TronMonitorModule,
    // EthMonitorModule,
    BtcMonitorModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
