import { Chain } from '@/common/enums/chain.enum'
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

  async getAddresses(chain: Chain): Promise<string[]> {
    return this.redisRepository.getArray(`${chain}:address`)
  }

  async addAddress(chain: Chain, address: string | string[]) {
    await this.redisRepository.setArray(`${chain}:address`, Array.isArray(address) ? address : [address])
  }
}
