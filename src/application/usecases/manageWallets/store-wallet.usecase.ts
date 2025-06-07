import { Chain } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { BtcMonitorService } from '@/infrastructure/blockchain/btc/btcMonitor.service'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { TronMonitorService } from '@/infrastructure/blockchain/tron/tronMonitor.service'
import { Injectable } from '@nestjs/common'

@Injectable()
export class StoreWalletUseCase {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly ethMonitorService: EthMonitorService,
    private readonly btcMonitorService: BtcMonitorService,
    private readonly tronMonitorService: TronMonitorService,
  ) {}

  addWallets(wallets: Wallet[]) {
    wallets.forEach((wallet) => {
      if (wallet.chain === Chain.ETH) this.ethMonitorService.addAddress(wallet.address)

      if (wallet.chain === Chain.BTC) this.btcMonitorService.addAddress(wallet.address)

      if (wallet.chain === Chain.TRON) this.tronMonitorService.addAddress(wallet.address)
    })

    return this.walletRepository.createEntities(wallets)
  }
}
