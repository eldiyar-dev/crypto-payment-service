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

  addWallets(wallets: Wallet[]) {
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

    lowerCaseWallets.concat(dublicateEVMWallets).forEach((wallet) => {
      this.logger.log(`Adding address ${wallet.address} to ${wallet.chain}`)
      void this.redisService.addAddress(wallet.chain, wallet.address)

      void this.walletRepository.createEntity(wallet)
    })
  }
}
