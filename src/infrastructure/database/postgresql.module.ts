import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { TConfiguration } from '../config/configuration'

export const DatabaseModule = TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService<TConfiguration>) => configService.get('postgres', { infer: true })!,
  inject: [ConfigService],
})
