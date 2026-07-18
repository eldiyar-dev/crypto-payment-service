import { Chain } from '@/common/enums/chain.enum'
import { Injectable, Logger } from '@nestjs/common'
import { RedisRepository } from '@/infrastructure/redis/repository/redis.repository'

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name)

  constructor(private readonly redisRepository: RedisRepository) {}

  async getAddresses(chain: Chain): Promise<string[]> {
    return this.redisRepository.getArray(`${chain}:address`)
  }

  async addAddress(chain: Chain, address: string | string[]) {
    await this.redisRepository.setArray(`${chain}:address`, Array.isArray(address) ? address : [address])
  }

  /** Number of addresses cached for a chain, for reconciliation against the durable store. */
  async countAddresses(chain: Chain): Promise<number> {
    return this.redisRepository.scard(`${chain}:address`)
  }

  /**
   * Compares the cached allow-list against the authoritative Postgres count and reports any
   * divergence.
   *
   * A short cache means deposits to the missing addresses are silently undetectable: the
   * membership check simply returns false, with no error anywhere. This turns that into a
   * visible, alertable condition at boot.
   */
  async verifyAddressCache(chain: Chain, expectedCount: number): Promise<boolean> {
    const cachedCount = await this.countAddresses(chain)
    if (cachedCount >= expectedCount) return true

    this.logger.error(`Address cache for ${chain} holds ${cachedCount} of ${expectedCount} known addresses — deposits to the missing addresses will NOT be detected`)
    return false
  }

  async addFeeTransactionHash(txHash: string) {
    this.logger.log(`Adding fee transaction hash ${txHash}`)
    await this.redisRepository.set(`fee:txHash:${txHash}`, '1')

    // Remove the transaction hash after 10 minutes
    await this.redisRepository.expire(`fee:txHash:${txHash}`, 10 * 60)
  }

  async isFeeTransactionHash(txHash: string): Promise<boolean> {
    const value = await this.redisRepository.get(`fee:txHash:${txHash}`)
    return value === '1'
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

  private readonly btcPendingKey = 'btc:pending:txs'

  async setBtcPendingTransaction(txHash: string) {
    await this.redisRepository.sadd(this.btcPendingKey, txHash)
  }

  async getBtcPendingTransactions(): Promise<string[]> {
    return this.redisRepository.smembers(this.btcPendingKey)
  }

  async removeBtcPendingTransaction(txHash: string) {
    await this.redisRepository.srem(this.btcPendingKey, txHash)
  }
}
