import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Redis, RedisKey } from 'ioredis'

@Injectable()
export class RedisRepository implements OnModuleDestroy {
  constructor(@Inject('RedisClient') private readonly redisClient: Redis) {}

  onModuleDestroy(): void {
    this.redisClient.disconnect()
  }

  get(key: RedisKey) {
    return this.redisClient.get(key)
  }

  set(key: RedisKey, value: string) {
    return this.redisClient.set(key, value)
  }

  setArray(key: RedisKey, value: (string | Buffer | number)[] | string | Buffer | number) {
    return this.redisClient.sadd(key, ...(Array.isArray(value) ? value : [value]))
  }

  getArray(key: RedisKey) {
    return this.redisClient.smembers(key)
  }

  delete(...keys: RedisKey[]) {
    return this.redisClient.del(keys)
  }

  setWithExpiry(key: string, value: string, expiry: number) {
    return this.redisClient.set(key, value, 'EX', expiry)
  }

  retrievalCount(key: string) {
    return this.redisClient.incr(`${key}:retrieval_count`)
  }

  deleteRetrievalCount(key: string) {
    return this.delete(`${key}:retrieval_count`)
  }

  exists(...keys: string[]) {
    return this.redisClient.exists(keys)
  }
}
