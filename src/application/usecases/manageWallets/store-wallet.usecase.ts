import { Chain, EVM_CHAINS } from '@/common/enums'
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
