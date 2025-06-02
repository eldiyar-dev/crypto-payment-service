import configuration from '@/infrastructure/config/configuration'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
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
    TronMonitorModule,
    EthMonitorModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
