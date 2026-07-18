import { Chain } from '@/common/enums'
import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { ChainCheckpoint } from '@/domain/entities/chainCheckpoint.entity'
import { Deposit } from '@/domain/entities/deposit.entity'
import { Wallet } from '@/domain/entities/wallet.entity'
import { RedactingTypeOrmLogger } from '@/infrastructure/database/redacting-typeorm.logger'
import type { ThrottlerModuleOptions } from '@nestjs/throttler'
import type { TypeOrmModuleOptions } from '@nestjs/typeorm/dist'
import type { RedisOptions } from 'ioredis'

const envInt = (name: string, fallback: number): number => parseInt(process.env[name] ?? '', 10) || fallback

export default () =>
  <TConfiguration>{
    /**
     * Block depth required before a deposit is acted on, per chain.
     *
     * The sweep is immediate and irreversible, so acting on a deposit that can still be
     * reorganised out means paying out against a deposit that no longer exists. ETH/EVM
     * previously fired at depth 0 and TRON's threshold of 1 was always satisfied by
     * construction, so both were effectively ungated.
     */
    confirmations: {
      [Chain.TRON]: envInt('TRON_CONFIRMATIONS', 19), // TRON irreversibility is ~19 blocks
      [Chain.BTC]: envInt('BTC_CONFIRMATIONS', 2),
      [Chain.ETH]: envInt('ETH_CONFIRMATIONS', 12),
      [Chain.EVM_BASE]: envInt('BASE_CONFIRMATIONS', 12),
      [Chain.EVM_BSC]: envInt('BSC_CONFIRMATIONS', 15),
      [Chain.EVM_POLYGON]: envInt('POLYGON_CONFIRMATIONS', 30),
      [Chain.EVM_ARBITRUM]: envInt('ARBITRUM_CONFIRMATIONS', 20),
      [Chain.EVM_OPTIMISM]: envInt('OPTIMISM_CONFIRMATIONS', 20),
      [Chain.EVM_AVALANCHE_C]: envInt('AVALANCHE_C_CONFIRMATIONS', 15),
      [Chain.EVM_FANTOM]: envInt('FANTOM_CONFIRMATIONS', 15),
    },
    port: parseInt(process.env.PORT ?? '', 10) || 3000,
    backHostUrl: process.env.BACK_HOST_URL,
    swaggerPass: process.env.SWAGGER_PASS,
    postgres: {
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT ?? '', 10) || 5432,
      database: process.env.POSTGRES_DATABASE,
      type: 'postgres',
      entities: [Wallet, Deposit, ChainCheckpoint],
      synchronize: true,
      // `logging: true` logged every statement with its bound parameters, writing plaintext
      // Wallet.privateKey values into logs/*.log on each INSERT. Statement-level logging is now
      // opt-in, and RedactingTypeOrmLogger drops parameters on every path including errors.
      logging: process.env.TYPEORM_LOG_QUERIES === 'true' ? ['query', 'error', 'warn', 'schema', 'migration'] : ['error', 'warn', 'schema', 'migration'],
      logger: new RedactingTypeOrmLogger(),
    },
    redis: {
      port: +process.env.REDIS_PORT!,
      host: process.env.REDIS_HOST,
      password: process.env.REDIS_PASSWORD,
    },
    throttler: [{ ttl: 60000, limit: 10 }],
    client_api_url: process.env.CLIENT_API_URL,
    client_api_key: process.env.CLIENT_API_KEY,
    client_api_timeout_ms: parseInt(process.env.CLIENT_API_TIMEOUT_MS ?? '', 10) || 10_000,
    // Escape hatch for local development only. In any other environment a plain-HTTP client API
    // exposes destination addresses and hot-wallet key material in transit.
    allow_insecure_client_api: process.env.ALLOW_INSECURE_CLIENT_API === 'true',
    private_key_secret: process.env.PRIVATE_KEY_SECRET,
    // Opt-in escape hatch for wallet rows written before encryption existed. Fails closed by
    // default: a plaintext key is refused rather than silently used. Set to 'true' only while
    // migrating legacy rows, then unset once every key has been re-encrypted and rotated.
    allow_legacy_plaintext_keys: process.env.ALLOW_LEGACY_PLAINTEXT_KEYS === 'true',
    // Opt-in. With PM2 instances > 1 each instance would otherwise run its own monitors and
    // scan the same blocks; the deposit ledger stops that duplicating withdrawals, this stops
    // it duplicating the scan work.
    monitor_leader_election: process.env.MONITOR_LEADER_ELECTION === 'true',
    ip_whitelist: (process.env.IP_WHITELIST ?? '')?.split(','),
    api_key_secret: process.env.API_KEY_SECRET,

    tron_usdt_contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    tron_host_url: process.env.TRON_HOST_URL,
    tron_pro_api_key: process.env.TRON_PRO_API_KEY,
    tronsave_api_url: process.env.TRONSAVE_API_URL,
    tronsave_receiver_address: process.env.TRONSAVE_RECEIVER_ADDRESS,
    tronsave_api_key: process.env.TRONSAVE_API_KEY,

    btc_api_url: process.env.BTC_API_URL,

    evmNetworks: {
      ETH: {
        coinContractAddress: {
          USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.0007',
        rpcUrl: process.env.ETH_RPC_URL,
        wssUrl: process.env.ETH_WSS_URL,
      },
      EVM_BASE: {
        coinContractAddress: {
          USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.0002',
        rpcUrl: process.env.BASE_RPC_URL,
        wssUrl: process.env.BASE_WSS_URL,
      },
      EVM_BSC: {
        coinContractAddress: {
          USDT: '0x55d398326f99059ff775485246999027b3197955',
        },
        coinDecimals: {
          USDT: 18,
        },
        nativeGasFallback: '0.003',
        rpcUrl: process.env.BSC_RPC_URL,
        wssUrl: process.env.BSC_WSS_URL,
      },
      EVM_POLYGON: {
        coinContractAddress: {
          USDT: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.05',
        rpcUrl: process.env.POLYGON_RPC_URL,
        wssUrl: process.env.POLYGON_WSS_URL,
      },
      EVM_ARBITRUM: {
        coinContractAddress: {
          USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.0005',
        rpcUrl: process.env.ARBITRUM_RPC_URL,
        wssUrl: process.env.ARBITRUM_WSS_URL,
      },
      EVM_OPTIMISM: {
        coinContractAddress: {
          USDT: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.0002',
        rpcUrl: process.env.OPTIMISM_RPC_URL,
        wssUrl: process.env.OPTIMISM_WSS_URL,
      },
      EVM_AVALANCHE_C: {
        coinContractAddress: {
          USDT: '0xc7198437980c041c805a1edcba50c1ce5db95118',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.02',
        rpcUrl: process.env.AVALANCHE_C_RPC_URL,
        wssUrl: process.env.AVALANCHE_C_WSS_URL,
      },
      EVM_FANTOM: {
        coinContractAddress: {
          USDT: '0x049d68029688eabf473097a2fc38ef61d3530b6e',
        },
        coinDecimals: {
          USDT: 6,
        },
        nativeGasFallback: '0.05',
        rpcUrl: process.env.FANTOM_RPC_URL,
        wssUrl: process.env.FANTOM_WSS_URL,
      },
    },
  }

export type TConfiguration = {
  confirmations: Record<Chain, number>
  port: number
  /**
   * @example https://example.com
   */
  backHostUrl: string
  swaggerPass: string
  postgres: TypeOrmModuleOptions
  redis: { port: RedisOptions['port']; host: RedisOptions['host']; password: RedisOptions['password'] }
  throttler: ThrottlerModuleOptions
  client_api_url: string
  client_api_key: string
  client_api_timeout_ms: number
  allow_insecure_client_api: boolean
  private_key_secret: string
  allow_legacy_plaintext_keys: boolean
  monitor_leader_election: boolean
  ip_whitelist: string[]
  api_key_secret: string

  tron_usdt_contract_address: string
  tron_host_url: string
  tron_pro_api_key: string
  tronsave_api_url: string
  tronsave_receiver_address: string
  tronsave_api_key: string

  evmNetworks: {
    [key in EvmNetwork]: {
      coinContractAddress: {
        [key in EvmCoin]: string
      }
      coinDecimals: {
        [key in EvmCoin]: number
      }
      /**
       * Gas ceiling used when estimation fails, as a decimal string in the chain's NATIVE
       * token — which is BNB on BSC, POL on Polygon, AVAX on Avalanche, not ETH.
       */
      nativeGasFallback: string
      rpcUrl: string
      wssUrl: string
    }
  }

  btc_api_url: string
}
