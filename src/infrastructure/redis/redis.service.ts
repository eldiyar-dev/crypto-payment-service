import { Chain } from '@/common/enums/chain.enum'
import { Injectable, Logger } from '@nestjs/common'
import { RedisRepository } from '@/infrastructure/redis/repository/redis.repository'

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name)

  constructor(private readonly redisRepository: RedisRepository) {}

  /**
   * Loads the entire address set.
   *
   * O(N) and it materialises every member — at 3M addresses that is >100MB transferred and a
   * 3M-element array allocated per call. Never use this on the detection path; use
   * {@link isKnownAddress} or {@link filterKnownAddresses}, which is the only question the
   * detection path actually asks.
   */
  async getAddresses(chain: Chain): Promise<string[]> {
    return this.redisRepository.getArray(`${chain}:address`)
  }

  /** O(1) membership test — the detection path's primitive. */
  async isKnownAddress(chain: Chain, address: string): Promise<boolean> {
    return (await this.redisRepository.sismember(`${chain}:address`, address)) === 1
  }

  /**
   * Batched membership test, for callers that already have a set of candidates (a Bitcoin
   * block's outputs). One round trip instead of one per candidate.
   *
   * @returns Only those candidates that are monitored addresses.
   */
  async filterKnownAddresses(chain: Chain, addresses: string[]): Promise<Set<string>> {
    if (!addresses.length) return new Set()

    const unique = [...new Set(addresses)]
    const flags = await this.redisRepository.smismember(`${chain}:address`, unique)

    return new Set(unique.filter((_, index) => flags[index] === 1))
  }

  async addAddress(chain: Chain, address: string | string[]) {
    await this.redisRepository.setArray(`${chain}:address`, Array.isArray(address) ? address : [address])
  }

  /**
   * Removes an address from the monitored set.
   *
   * Nothing removed addresses on wallet deletion, so a soft-deleted wallet kept detecting
   * deposits that could never be swept — invisibly, because the sweep's only failure branch
   * for a missing wallet returned without reporting.
   */
  async removeAddress(chain: Chain, address: string) {
    await this.redisRepository.srem(`${chain}:address`, address)
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

  /**
   * Claims an API key signature as used, atomically.
   *
   * SET NX with a TTL matching the key's validity window: the first caller to present a given
   * signature wins, every replay within the window loses. Without this a captured key was
   * replayable for its full lifetime.
   *
   * @returns True if this call claimed the nonce (i.e. the key had not been used).
   */
  async claimApiKeyNonce(signature: string, ttlMs: number): Promise<boolean> {
    return this.redisRepository.setIfAbsent(`apikey:nonce:${signature}`, '1', ttlMs)
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
    await this.redisRepository.delete(this.btcAttemptsKey(txHash))
  }

  private readonly btcDeadLetterKey = 'btc:deadletter:txs'
  private readonly btcAttemptsKey = (txHash: string) => `btc:pending:attempts:${txHash}`

  /** Counts how many times a pending txid has failed to resolve. */
  async incrementBtcPendingAttempts(txHash: string): Promise<number> {
    const key = this.btcAttemptsKey(txHash)
    const attempts = await this.redisRepository.increment(key)

    // Expire alongside the pending entry so a resolved tx leaves nothing behind.
    if (attempts === 1) await this.redisRepository.expire(key, 7 * 24 * 60 * 60)

    return attempts
  }

  /**
   * Moves an unresolvable txid out of the pending set into a dead-letter set.
   *
   * Without this, a txid whose lookup keeps failing stayed in `btc:pending:txs` forever: it was
   * re-fetched every 60s, the set grew without bound, and nothing surfaced the fact that a
   * detected deposit was never confirmed.
   */
  async deadLetterBtcTransaction(txHash: string) {
    await this.redisRepository.sadd(this.btcDeadLetterKey, txHash)
    await this.removeBtcPendingTransaction(txHash)
  }

  async getBtcDeadLetteredTransactions(): Promise<string[]> {
    return this.redisRepository.smembers(this.btcDeadLetterKey)
  }
}
