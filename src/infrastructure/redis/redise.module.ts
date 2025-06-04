import { Global, Module } from '@nestjs/common'
import { redisClientFactory } from './redis.client.factory'
import { RedisService } from './redis.service'
import { RedisRepository } from './repository/redis.repository'

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [redisClientFactory, RedisRepository, RedisService],
  exports: [RedisService],
})
export class RedisModule {}
