import { Chain, Currency } from '@/common/enums'
import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { ETH_DECIMALS, formatBaseUnits, parseBaseUnits, sleep, withRetry } from '@/common/utils'
import { ChainCheckpointRepository } from '@/domain/repositories/chainCheckpointRepository'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: {
  address: string
  amount: bigint
  decimals: number
  currency: Currency
  txHash: string
  /** Log index for token transfers; 0 for native transfers, which credit one address per tx. */
  outputIndex: number
  blockHash?: string | null
  blockNumber?: bigint | null
  evmNetwork: EvmNetwork
}) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
    private readonly chainCheckpointRepository: ChainCheckpointRepository,
  ) {}

  /** Dust thresholds, held as decimal strings and converted to base units per network. */
  private readonly minEthDeposit = '0.001' // 0.001 ETH
  private readonly minUsdtDeposit = '0.5' // 0.5 USDT

  private depositCallback: DepositCallback

  // ERC20 ABI for Transfer event
  private readonly ERC20_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)']
  private readonly erc20Interface = new ethers.Interface(this.ERC20_ABI)
  private readonly transferTopic = ethers.id('Transfer(address,address,uint256)')

  /** Highest block already scanned per network, so a range is never skipped. */
  private readonly lastScannedBlock = new Map<EvmNetwork, number>()

  /**
   * Exactly one live provider per network. A shared `usdtContract` field also meant that
   * starting a second network silently replaced the first network's contract subscription.
   */
  private readonly providers = new Map<EvmNetwork, ethers.WebSocketProvider>()
  /** Networks with a reconnect already in flight, so concurrent error events collapse into one. */
  private readonly reconnecting = new Set<EvmNetwork>()
  private readonly reconnectAttempts = new Map<EvmNetwork, number>()
  private stopped = false

  private readonly MAX_RECONNECT_ATTEMPTS = 12
  private readonly BASE_RECONNECT_DELAY_MS = 1_000
  private readonly MAX_RECONNECT_DELAY_MS = 60_000

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  private getProviderWssUrl(evmNetwork: EvmNetwork) {
    return this.configService.get(`evmNetworks.${evmNetwork}.wssUrl`, { infer: true })!
  }

  private getCoinContractAddress(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!
  }

  /** USDT is 6 decimals on Ethereum but 18 on BSC, so decimals are per-network. */
  private getCoinDecimals(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinDecimals.${coin}`, { infer: true })!
  }

  /**
   * Starts (or restarts) the block and USDT subscriptions for one network.
   *
   * Any existing provider for the network is torn down first, so there is always exactly one
   * live provider per network. Previously `provider.on('error')` and `provider.websocket.onerror`
   * each called reconnect() independently: a single socket failure spawned two new providers,
   * each with its own block listener and USDT subscription, and only one was reachable via the
   * closure. Every subsequent block was then scanned 2x, 4x, 8x..., invoking the deposit
   * callback once per duplicate listener.
   */
  async start(evmNetwork: EvmNetwork) {
    if (this.stopped) return

    await this.teardown(evmNetwork)

    try {
      const provider = new ethers.WebSocketProvider(this.getProviderWssUrl(evmNetwork))
      this.providers.set(evmNetwork, provider)

      // Every failure signal funnels into the same guarded path, which is idempotent.
      void provider.on('error', (err: Error) => {
        this.logger.error(`WebSocketProvider error network: ${evmNetwork}: ${err.message}`)
        void this.scheduleReconnect(evmNetwork)
      })

      const socket = this.socketHandlers(provider)
      socket.onerror = (err) => {
        this.logger.error(`WebSocket error network: ${evmNetwork}: ${err?.message ?? 'unknown'}`)
        void this.scheduleReconnect(evmNetwork)
      }
      // A clean close is still a lost subscription: without this, a server-side disconnect
      // leaves the monitor silently deaf rather than reconnecting.
      socket.onclose = () => {
        this.logger.warn(`WebSocket closed network: ${evmNetwork}`)
        void this.scheduleReconnect(evmNetwork)
      }

      await this.listenEthTransfers(provider, evmNetwork)

      // Only a fully established subscription resets the backoff.
      this.reconnectAttempts.set(evmNetwork, 0)
      this.logger.log(`ETH monitor started network: ${evmNetwork}`)
    } catch (err) {
      this.logger.error(`Error starting ETH monitor network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`)
      void this.scheduleReconnect(evmNetwork)
    }
  }

  /**
   * Reconnects a network at most once at a time, with exponential backoff, jitter and a cap.
   *
   * The guard is what makes duplicate listeners impossible: concurrent error/close events for
   * the same network observe `reconnecting` and return without spawning a second provider.
   */
  private async scheduleReconnect(evmNetwork: EvmNetwork) {
    if (this.stopped || this.reconnecting.has(evmNetwork)) return
    this.reconnecting.add(evmNetwork)

    const attempt = (this.reconnectAttempts.get(evmNetwork) ?? 0) + 1
    this.reconnectAttempts.set(evmNetwork, attempt)

    if (attempt > this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnecting.delete(evmNetwork)
      this.logger.error(`Giving up reconnecting network: ${evmNetwork} after ${this.MAX_RECONNECT_ATTEMPTS} attempts — deposits on this network are NOT being detected`)
      return
    }

    // Full jitter, so a shared RPC outage does not produce a synchronised retry storm.
    const backoff = Math.min(this.BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1), this.MAX_RECONNECT_DELAY_MS)
    const delay = Math.floor(Math.random() * backoff)
    this.logger.warn(`Reconnecting network: ${evmNetwork} in ${delay}ms (attempt ${attempt}/${this.MAX_RECONNECT_ATTEMPTS})`)

    await sleep(delay)
    this.reconnecting.delete(evmNetwork)

    await this.start(evmNetwork)
  }

  /**
   * ethers types `provider.websocket` as `WebSocketLike`, which does not declare `onclose`.
   * The underlying socket does have it, so it is surfaced here in one narrowly-typed place.
   */
  private socketHandlers(provider: ethers.WebSocketProvider) {
    return provider.websocket as unknown as {
      onerror: ((err: { message?: string } | null) => void) | null
      onclose: (() => void) | null
    }
  }

  /** Removes listeners and destroys the provider for a network, if one is live. */
  private async teardown(evmNetwork: EvmNetwork) {
    const existing = this.providers.get(evmNetwork)
    if (!existing) return

    this.providers.delete(evmNetwork)
    try {
      // Detach the handlers first, or destroying the socket schedules another reconnect.
      const socket = this.socketHandlers(existing)
      socket.onerror = null
      socket.onclose = null
      await existing.removeAllListeners()
      await existing.destroy()
    } catch (err) {
      this.logger.warn(`Error tearing down provider network: ${evmNetwork}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stops all subscriptions permanently. Used on graceful shutdown. */
  async stop() {
    this.stopped = true
    await Promise.all([...this.providers.keys()].map((evmNetwork) => this.teardown(evmNetwork)))
  }

  /**
   * Subscribes to new heads, but scans blocks only once they are buried under the configured
   * confirmation depth.
   *
   * Previously the deposit callback fired the moment a transaction appeared in a fetched block
   * — depth 0. Because the sweep that follows is immediate and irreversible, a deposit that was
   * later reorganised out had already been paid out against.
   */
  private async listenEthTransfers(provider: ethers.WebSocketProvider, evmNetwork: EvmNetwork) {
    return provider.on('block', async (head: number) => {
      try {
        await this.scanConfirmedBlocks(provider, head, evmNetwork)
      } catch (err) {
        this.logger.error(`Error processing block network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  /**
   * Scans every block that has just reached the confirmation depth.
   *
   * Advancing through a range rather than scanning a single block means a missed or
   * out-of-order head notification does not silently skip a block.
   */
  private async scanConfirmedBlocks(provider: ethers.WebSocketProvider, head: number, evmNetwork: EvmNetwork) {
    const confirmations = this.getConfirmations(evmNetwork)
    const target = head - confirmations
    if (target < 0) return

    // Resume from the durable checkpoint so downtime is a gap that gets scanned, not lost.
    // Only on a chain that has never been scanned do we start at the tip.
    let lastScanned = this.lastScannedBlock.get(evmNetwork)
    if (lastScanned === undefined) {
      lastScanned = (await this.chainCheckpointRepository.getLastScannedBlock(evmNetwork)) ?? target - 1
      this.logger.log(`Resuming ${evmNetwork} scan from block ${lastScanned + 1}`)
    }

    for (let blockNumber = lastScanned + 1; blockNumber <= target; blockNumber++) {
      this.logger.log(`Checking confirmed block ${blockNumber} (head ${head}, depth ${confirmations}) network: ${evmNetwork}`)
      await this.checkBlockForDeposits(provider, blockNumber, evmNetwork)

      // Advance the checkpoint only after the block is fully processed, so a crash mid-block
      // re-scans it rather than skipping it. Re-scanning is safe: the deposit ledger's unique
      // key makes re-delivery a no-op.
      this.lastScannedBlock.set(evmNetwork, blockNumber)
      await this.chainCheckpointRepository.setLastScannedBlock(evmNetwork, blockNumber)
    }
  }

  private getConfirmations(evmNetwork: EvmNetwork): number {
    return this.configService.get(`confirmations.${evmNetwork}`, { infer: true })!
  }

  private async checkBlockForDeposits(provider: ethers.WebSocketProvider, blockNumber: number, evmNetwork: EvmNetwork) {
    const block = await this.getBlockWithRetry(provider, blockNumber)
    if (!block) {
      this.logger.error(`Block ${blockNumber} not found network: ${evmNetwork}`)
      return
    }

    await this.checkNativeTransfers(block, blockNumber, evmNetwork)
    await this.checkTokenTransfers(provider, block, blockNumber, evmNetwork)
  }

  private async checkNativeTransfers(block: ethers.Block, blockNumber: number, evmNetwork: EvmNetwork) {
    const minDeposit = parseBaseUnits(this.minEthDeposit, ETH_DECIMALS)

    for (const tx of block.prefetchedTransactions) {
      if (await this.redisService.isFeeTransactionHash(tx.hash)) {
        this.logger.log(`Ignoring fee transaction: ${tx.hash}`)
        continue
      }

      if (!tx?.to) continue

      const to = tx.to.toLowerCase()
      // SISMEMBER: O(1) against the set, instead of loading every monitored address and
      // linear-scanning the result once per transaction.
      if (!(await this.redisService.isKnownAddress(Chain.ETH, to))) continue

      // tx.value is already exact wei — never narrow it through a float.
      const amountWei = tx.value
      if (amountWei < minDeposit) continue

      this.logger.log(`Deposit detected: ${formatBaseUnits(amountWei, ETH_DECIMALS)} ETH from ${tx.from} to ${to} txHash: ${tx.hash} network: ${evmNetwork}`)
      this.depositCallback({
        address: to,
        amount: amountWei,
        decimals: ETH_DECIMALS,
        currency: Currency.ETH,
        txHash: tx.hash,
        outputIndex: 0,
        blockHash: block.hash,
        blockNumber: BigInt(blockNumber),
        evmNetwork,
      })
    }
  }

  /**
   * Reads USDT Transfer events for one confirmed block via eth_getLogs.
   *
   * This replaces a live `contract.on('Transfer')` subscription, which fired at depth 0 and
   * could not be confirmation-gated. Querying a settled block also means the token path and
   * the native path share one confirmation rule and one scan checkpoint.
   */
  private async checkTokenTransfers(provider: ethers.WebSocketProvider, block: ethers.Block, blockNumber: number, evmNetwork: EvmNetwork) {
    const decimals = this.getCoinDecimals(evmNetwork, 'USDT')
    const minDeposit = parseBaseUnits(this.minUsdtDeposit, decimals)

    const logs = await provider.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber,
      address: this.getCoinContractAddress(evmNetwork, 'USDT'),
      topics: [this.transferTopic],
    })

    for (const log of logs) {
      try {
        const parsed = this.erc20Interface.parseLog({ topics: [...log.topics], data: log.data })
        if (!parsed) continue

        const to = (parsed.args.to as string).toLowerCase()
        if (!(await this.redisService.isKnownAddress(Chain.ETH, to))) continue

        const amountBase = ethers.toBigInt(parsed.args.value as ethers.BigNumberish)
        if (amountBase < minDeposit) continue

        this.logger.log(`Deposit detected: ${formatBaseUnits(amountBase, decimals)} USDT from ${parsed.args.from} to ${to} txHash: ${log.transactionHash} network: ${evmNetwork}`)
        this.depositCallback({
          address: to,
          amount: amountBase,
          decimals,
          currency: Currency.USDT,
          txHash: log.transactionHash,
          // Distinguishes multiple USDT transfers to the same address within one transaction.
          outputIndex: log.index,
          blockHash: block.hash,
          blockNumber: BigInt(blockNumber),
          evmNetwork,
        })
      } catch (err) {
        this.logger.error(`Error processing USDT transfer network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private async getBlockWithRetry(provider: ethers.WebSocketProvider, blockNumber: number): Promise<ethers.Block | null> {
    return withRetry(() => provider.getBlock(blockNumber, true))
  }
}
