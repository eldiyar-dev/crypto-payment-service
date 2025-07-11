import { Chain } from '@/common/enums'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  private readonly depositQueue: Array<() => Promise<void>> = []
  private isProcessingQueue = false

  private async processQueue() {
    if (this.isProcessingQueue) return
    this.isProcessingQueue = true
    while (this.depositQueue.length > 0) {
      const task = this.depositQueue.shift()
      if (task) {
        try {
          await task()
        } catch (err) {
          this.logger.error('Error processing deposit queue task', err)
        }
      }
    }
    this.isProcessingQueue = false

    if (this.depositQueue.length) await this.processQueue()
  }

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly depositService: DepositService,
    private readonly walletRepository: WalletRepository,
    private readonly splitWithdrawUseCase: SplitWithdrawUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) void this.redisService.addAddress(Chain.ETH, dbWallets)

    this.execute()

    void this.ethMonitorService.start(Chain.ETH)
    // void this.ethMonitorService.start(Chain.EVM_BASE)
    // void this.ethMonitorService.start(Chain.EVM_BSC)
    // void this.ethMonitorService.start(Chain.EVM_POLYGON)
    // void this.ethMonitorService.start(Chain.EVM_ARBITRUM)
    // void this.ethMonitorService.start(Chain.EVM_OPTIMISM)
    // void this.ethMonitorService.start(Chain.EVM_AVALANCHE_C)
    // void this.ethMonitorService.start(Chain.EVM_FANTOM)
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.ETH)
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount, currency, txHash, evmNetwork }) => {
      this.depositQueue.push(async () => {
        this.logger.log(`New ETH deposit: ${address} ${amount} ${currency} txHash: ${txHash} evmNetwork: ${evmNetwork}`)

        void this.depositService.notifyNewDeposit({ currency, address, amount, txHash, chain: evmNetwork })
        await this.splitWithdrawUseCase.execute({ currency, address, amount, chain: evmNetwork })
      })
      void this.processQueue()
    })
  }
}
