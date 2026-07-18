import { Chain, EVM_CHAINS } from '@/common/enums'
import { AESCipherService } from '@/common/services/aes.service'
import { isEvmNetwork } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class StoreWalletUseCase {
  private readonly logger = new Logger(StoreWalletUseCase.name)

  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly redisService: RedisService,
    private readonly btcMonitorService: BtcMonitorService,
    private readonly aesCipherService: AESCipherService,
  ) {}

  /**
   * Persists new wallets and adds them to the monitored set.
   *
   * Postgres is written first and both writes are awaited. Previously both were
   * fire-and-forget (`void`), and the controller returned 201 before either had completed:
   *
   * - a failed DB write still left the address in Redis, so the monitor detected deposits to
   *   an address whose key was never stored — the funds are then unrecoverable by this service;
   * - a failed Redis write left a wallet in the DB whose deposits are never detected.
   *
   * Ordering Postgres first makes the failure mode recoverable: the boot-time seed rebuilds
   * Redis from Postgres, so a lost cache write is self-healing while a lost DB write is not.
   * Errors propagate so the caller reports a real outcome instead of a false 201.
   */
  async addWallets(wallets: Wallet[]): Promise<void> {
    const lowerCaseWallets = wallets.map((wallet) => {
      // Encrypt custodial key material before it reaches Postgres. Done once per submitted
      // wallet so the EVM duplicates below share the same ciphertext.
      const privateKey = this.aesCipherService.encrypt(wallet.privateKey)

      // Only EVM addresses may be case-normalised. Bitcoin base58check addresses (1..., 3...)
      // are case-sensitive, so lowercasing one produces a different, invalid address: it would
      // never match an incoming deposit's output address, and would never match the address
      // derived from its own key at sweep time. Bech32 is lowercase already, so nothing is
      // gained by normalising BTC at all.
      if (isEvmNetwork(wallet.chain)) {
        return {
          ...wallet,
          privateKey,
          address: wallet.address.toLowerCase(),
        }
      }
      return { ...wallet, privateKey }
    })

    const dublicateEVMWallets: Wallet[] = []
    lowerCaseWallets.forEach((wallet) => {
      if (wallet.chain !== Chain.ETH) return

      EVM_CHAINS.forEach((chain) => {
        if (chain === Chain.ETH) return
        dublicateEVMWallets.push({ ...wallet, chain })
      })
    })

    const allWallets = lowerCaseWallets.concat(dublicateEVMWallets)

    // One batched insert instead of save() per wallet in a loop (which also issues a SELECT
    // before each INSERT), amplified 8x by the EVM duplication above.
    await this.walletRepository.createEntities(allWallets)
    this.logger.log(`Persisted ${allWallets.length} wallet row(s)`)

    // Only advertise addresses that are already durably stored. Grouped so each chain's set
    // is written with a single SADD.
    const addressesByChain = new Map<Chain, string[]>()
    for (const wallet of allWallets) {
      const existing = addressesByChain.get(wallet.chain)
      if (existing) existing.push(wallet.address)
      else addressesByChain.set(wallet.chain, [wallet.address])
    }

    for (const [chain, addresses] of addressesByChain) {
      await this.redisService.addAddress(chain, addresses)
      this.logger.log(`Added ${addresses.length} address(es) to ${chain}`)
    }
  }
}
