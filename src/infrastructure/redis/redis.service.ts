import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisRepository } from 'src/infrastructure/redis/repository/redis.repository'
import { TConfiguration } from '../config/configuration'

@Injectable()
export class RedisService {
  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}
}
