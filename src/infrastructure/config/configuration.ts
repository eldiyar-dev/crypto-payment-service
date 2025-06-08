import { Wallet } from '@/domain/entities/wallet.entity'
import type { ThrottlerModuleOptions } from '@nestjs/throttler'
import type { TypeOrmModuleOptions } from '@nestjs/typeorm/dist'
import type { RedisOptions } from 'ioredis'

export default () =>
  <TConfiguration>{
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
      entities: [Wallet],
      synchronize: true,
      logging: true,
    },
    redis: {
      port: +process.env.REDIS_PORT!,
      host: process.env.REDIS_HOST,
    },
    throttler: [{ ttl: 60000, limit: 10 }],
    client_api_url: process.env.CLIENT_API_URL,
    private_key_secret: process.env.PRIVATE_KEY_SECRET,
    ip_whitelist: (process.env.IP_WHITELIST ?? '')?.split(','),
    api_key_secret: process.env.API_KEY_SECRET,

    tron_usdt_contract_address: process.env.TRON_USDT_CONTRACT_ADDRESS,
    tron_host_url: process.env.TRON_HOST_URL,
    tron_pro_api_key: process.env.TRON_PRO_API_KEY,
    tronsave_api_url: process.env.TRONSAVE_API_URL,
    tronsave_receiver_address: process.env.TRONSAVE_RECEIVER_ADDRESS,

    eth_usdt_contract_address: process.env.ETH_USDT_CONTRACT_ADDRESS,
    eth_rpc_url: process.env.ETH_RPC_URL,
    eth_wss_url: process.env.ETH_WSS_URL,

    btc_rpc_url: process.env.BTC_RPC_URL,

    blockcypher_api_key: process.env.BLOCKCYPHER_API_KEY,
  }

export type TConfiguration = {
  port: number
  /**
   * @example https://example.com
   */
  backHostUrl: string
  swaggerPass: string
  postgres: TypeOrmModuleOptions
  redis: { port: RedisOptions['port']; host: RedisOptions['host'] }
  throttler: ThrottlerModuleOptions
  client_api_url: string
  private_key_secret: string
  ip_whitelist: string[]
  api_key_secret: string

  tron_usdt_contract_address: string
  tron_host_url: string
  tron_pro_api_key: string
  tronsave_api_url: string
  tronsave_receiver_address: string

  eth_usdt_contract_address: string
  eth_rpc_url: string
  eth_wss_url: string

  btc_rpc_url: string

  blockcypher_api_key: string
}
