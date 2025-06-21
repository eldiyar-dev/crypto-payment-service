import { Chain } from '@/common/enums/chain.enum'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisRepository } from 'src/infrastructure/redis/repository/redis.repository'
import { TConfiguration } from '../config/configuration'

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name)

  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  async getAddresses(chain: Chain): Promise<string[]> {
    return this.redisRepository.getArray(`${chain}:address`)
  }

  async addAddress(chain: Chain, address: string | string[]) {
    this.logger.log(`Adding ${chain} address ${address.toString()}`)
    await this.redisRepository.setArray(`${chain}:address`, Array.isArray(address) ? address : [address])
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redisRepository.get(key)
    if (!value) return null
    try {
      return JSON.parse(value) as T
    } catch (e) {
      this.logger.error(`Failed to parse JSON for key ${key}: ${(e as Error).message}`)
      return null
    }
  }

  async set(key: string, value: any): Promise<void> {
    await this.redisRepository.set(key, JSON.stringify(value))
  }
}
