import { FactoryProvider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'
import type { TConfiguration } from '../config/configuration'

export const redisClientFactory: FactoryProvider<Redis> = {
  provide: 'RedisClient',
  useFactory: (configService: ConfigService<TConfiguration>) => {
    const redisConfig = configService.get('redis', { infer: true })
    if (!redisConfig) throw new Error('Redis configuration is missing')

    const redisInstance = new Redis(redisConfig)

    redisInstance.on('error', (e) => {
      throw new Error(`Redis connection failed: ${e}`)
    })

    return redisInstance
  },
  inject: [ConfigService],
}
