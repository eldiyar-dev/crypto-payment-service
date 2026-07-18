import { Global, Module } from '@nestjs/common'
import { LeaderElectionService } from './leaderElection.service'
import { redisClientFactory } from './redis.client.factory'
import { RedisService } from './redis.service'
import { RedisRepository } from './repository/redis.repository'

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [redisClientFactory, RedisRepository, RedisService, LeaderElectionService],
  exports: [RedisService, LeaderElectionService],
})
export class RedisModule {}
