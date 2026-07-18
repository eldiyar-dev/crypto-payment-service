import { Chain } from '@/common/enums'
import { formatBaseUnits } from '@/common/utils'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { TronMonitorService } from '../../../infrastructure/blockchain/tron/tronMonitor.service'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class TronMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TronMonitorUseCase.name)

  constructor(
    private readonly tronMonitorService: TronMonitorService,
    private readonly walletRepository: WalletRepository,
    private readonly processDepositUseCase: ProcessDepositUseCase,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    const dbWallets = await this.getDBWallets()
    if (dbWallets.length) void this.redisService.addAddress(Chain.TRON, dbWallets)

    this.execute()

    await this.tronMonitorService.start()
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down TRON monitoring (${signal ?? 'no signal'})`)
    this.tronMonitorService.stop()
  }

  async getDBWallets(): Promise<Wallet['address'][]> {
    return this.walletRepository.getWalletsByChain(Chain.TRON)
  }

  execute(): void {
    this.logger.log('Starting TRON monitoring...')

    this.tronMonitorService.onDeposit(async ({ address, amount, decimals, currency, txHash, outputIndex, blockHash, blockNumber }) => {
      this.logger.log(`New TRON deposit: ${address} ${formatBaseUnits(amount, decimals)} ${currency}`)

      await this.processDepositUseCase.execute({ chain: Chain.TRON, currency, address, amount, decimals, txHash, outputIndex, blockHash, blockNumber })
    })
  }
}
