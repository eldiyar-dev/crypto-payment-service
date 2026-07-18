import { EvmNetwork } from '@/common/interfaces'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Builds and caches the JSON-RPC providers used for reads and for sending transactions.
 *
 * Two problems this addresses:
 *
 * - **No failover or cross-checking.** Each chain had a single `rpcUrl` and the service acted
 *   on whatever it returned, irreversibly. A compromised or malfunctioning RPC could report
 *   fabricated balances or blocks. `*_RPC_URL` now accepts a comma-separated list, and when
 *   more than one is given a FallbackProvider requires agreement from a quorum before a
 *   result is accepted.
 * - **A new provider per call.** `new ethers.JsonRpcProvider(...)` was constructed on every
 *   read and every send, so nothing was pooled or reused. Providers are now built once per
 *   network and cached.
 *
 * Requests carry an explicit timeout; without one a hung RPC stalls the serial deposit queue.
 */
@Injectable()
export class EvmProviderFactory {
  private readonly logger = new Logger(EvmProviderFactory.name)

  private readonly providers = new Map<EvmNetwork, ethers.Provider>()

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  get(evmNetwork: EvmNetwork): ethers.Provider {
    const cached = this.providers.get(evmNetwork)
    if (cached) return cached

    const provider = this.build(evmNetwork)
    this.providers.set(evmNetwork, provider)
    return provider
  }

  private build(evmNetwork: EvmNetwork): ethers.Provider {
    const urls = this.rpcUrls(evmNetwork)
    if (!urls.length) throw new Error(`No RPC URL configured for ${evmNetwork}`)

    const providers = urls.map((url) => {
      const request = new ethers.FetchRequest(url)
      request.timeout = DEFAULT_TIMEOUT_MS
      // staticNetwork avoids an eth_chainId round trip on every provider construction.
      return new ethers.JsonRpcProvider(request, undefined, { staticNetwork: true })
    })

    if (providers.length === 1) {
      this.logger.warn(`${evmNetwork} has a single RPC endpoint — no failover and no cross-checking. Configure a comma-separated list to enable quorum.`)
      return providers[0]
    }

    // Require agreement from a majority before accepting a result, so one bad endpoint cannot
    // by itself convince the service that a deposit exists.
    const quorum = Math.floor(providers.length / 2) + 1
    this.logger.log(`${evmNetwork} using ${providers.length} RPC endpoints with quorum ${quorum}`)

    return new ethers.FallbackProvider(
      providers.map((provider) => ({ provider, stallTimeout: DEFAULT_TIMEOUT_MS })),
      undefined,
      { quorum },
    )
  }

  /** `*_RPC_URL` may hold a single URL or a comma-separated list. */
  private rpcUrls(evmNetwork: EvmNetwork): string[] {
    const configured = this.configService.get(`evmNetworks.${evmNetwork}.rpcUrl`, { infer: true })

    return String(configured ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
  }
}
