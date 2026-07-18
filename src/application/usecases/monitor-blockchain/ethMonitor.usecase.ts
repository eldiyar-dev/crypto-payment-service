import { Chain, EVM_CHAINS } from '@/common/enums'
import { EvmNetwork } from '@/common/interfaces'
import { fireAndForget, formatBaseUnits, SerialQueue } from '@/common/utils'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { EthMonitorService } from '@/infrastructure/blockchain/eth/ethMonitor.service'
import { LeaderElectionService } from '@/infrastructure/redis/leaderElection.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ProcessDepositUseCase } from './processDeposit.usecase'

@Injectable()
export class EthMonitorUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EthMonitorUseCase.name)

  /** Serial: concurrent sweeps race on the shared fee wallet's nonce and balance. */
  private readonly depositQueue = new SerialQueue(this.logger, 'ETH deposit')

  constructor(
    private readonly ethMonitorService: EthMonitorService,
    private readonly walletRepository: WalletRepository,
    private readonly processDepositUseCase: ProcessDepositUseCase,
    private readonly redisService: RedisService,
    private readonly leaderElectionService: LeaderElectionService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  async onModuleInit() {
    // Only one instance may run the monitors. Without this, raising PM2 `instances`
    // makes every instance scan the same blocks.
    if (!(await this.leaderElectionService.acquire())) return

    await this.seedAddressCache()

    this.execute()

    // Which EVM networks to monitor is configuration, not seven commented-out lines. Each
    // network adds an independent WebSocket subscription and reconnect loop to operate, so
    // enabling one is a deliberate act — but it no longer requires a code change.
    for (const evmNetwork of this.enabledNetworks()) {
      fireAndForget(this.ethMonitorService.start(evmNetwork), this.logger, `Starting ${evmNetwork} monitor`)
    }
  }

  /**
   * EVM networks to monitor, from ENABLED_EVM_NETWORKS. Defaults to ETH alone.
   *
   * Unknown entries are reported rather than silently ignored — a typo here means a chain
   * nobody is watching.
   */
  private enabledNetworks(): EvmNetwork[] {
    const configured = this.configService.get<TConfiguration['enabled_evm_networks']>('enabled_evm_networks') ?? []
    const valid = configured.filter((network): network is EvmNetwork => EVM_CHAINS.includes(network as Chain))

    const unknown = configured.filter((network) => !valid.includes(network as EvmNetwork))
    if (unknown.length) this.logger.error(`Ignoring unknown ENABLED_EVM_NETWORKS entries: ${unknown.join(', ')}`)

    return valid.length ? valid : [Chain.ETH]
  }

  /**
   * Rebuilds the monitored-address cache from Postgres, which is authoritative.
   *
   * Streamed in batches rather than loaded into one array: at 3M+ wallets a single query
   * materialises the whole set in memory before the monitor can start. Awaited, because
   * starting the monitor before the allow-list is populated means deposits arriving in that
   * window are not recognised.
   */
  private async seedAddressCache(): Promise<void> {
    let total = 0

    for await (const addresses of this.walletRepository.iterateAddressesByChain(Chain.ETH)) {
      await this.redisService.addAddress(Chain.ETH, addresses)
      total += addresses.length
    }

    if (total) await this.redisService.verifyAddressCache(Chain.ETH, total)
    this.logger.log(`Seeded ${total} ETH address(es)`)
  }

  execute(): void {
    this.logger.log('Starting ETH monitoring...')

    this.ethMonitorService.onDeposit(({ address, amount, decimals, currency, txHash, outputIndex, blockHash, blockNumber, evmNetwork }) => {
      // A rejected task (queue closed on shutdown, or full) is safe to drop: the deposit is
      // on-chain and the scan checkpoint has not advanced past it, so it is re-detected.
      this.depositQueue.push(async () => {
        this.logger.log(`New ETH deposit: ${address} ${formatBaseUnits(amount, decimals)} ${currency} txHash: ${txHash} evmNetwork: ${evmNetwork}`)

        await this.processDepositUseCase.execute({ chain: evmNetwork, currency, address, amount, decimals, txHash, outputIndex, blockHash, blockNumber })
      })
    })
  }

  /**
   * Stops accepting new deposits and drains what is already queued.
   *
   * Nest only calls this once `enableShutdownHooks()` is on. Without it, every deploy dropped
   * the in-memory queue and could kill a withdrawal after broadcast but before the ledger was
   * updated — money moved on-chain with no record of it.
   */
  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutting down ETH monitoring (${signal ?? 'no signal'})`)

    this.depositQueue.close()
    await this.ethMonitorService.stop()

    this.logger.log(`Draining ${this.depositQueue.size} queued deposit(s)`)
    await this.depositQueue.drain()

    this.logger.log('ETH monitoring stopped')
  }
}
