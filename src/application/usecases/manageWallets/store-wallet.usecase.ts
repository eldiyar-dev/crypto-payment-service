import { Chain } from '@/common/enums'
import { isEvmNetwork } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable } from '@nestjs/common'

@Injectable()
export class StoreWalletUseCase {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly redisService: RedisService,
    private readonly btcMonitorService: BtcMonitorService,
  ) {}

  addWallets(wallets: Wallet[]) {
    const lowerCaseWallets = wallets.map((wallet) => {
      if (isEvmNetwork(wallet.chain) || wallet.chain === Chain.BTC) {
        return {
          ...wallet,
          address: wallet.address.toLowerCase(),
        }
      }
      return wallet
    })

    lowerCaseWallets.forEach((wallet) => {
      if (wallet.chain === Chain.BTC) {
        void this.redisService.addAddress(Chain.BTC, wallet.address)
        this.btcMonitorService.addAddress(wallet.address)
      } else void this.redisService.addAddress(wallet.chain, wallet.address)

      void this.walletRepository.createEntity(wallet)
    })
  }
}
