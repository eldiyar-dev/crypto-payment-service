import type { ThrottlerModuleOptions } from '@nestjs/throttler'
import type { TypeOrmModuleOptions } from '@nestjs/typeorm/dist'

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
      entities: [],
      synchronize: true,
      logging: true,
    },
    throttler: [{ ttl: 60000, limit: 10 }],
    tron_pro_api_key: process.env.TRON_PRO_API_KEY,
    infura_api_key: process.env.INFURA_API_KEY,
    blockcypher_api_key: process.env.BLOCKCYPHER_API_KEY,
    client_api_url: process.env.CLIENT_API_URL,
  }

export type TConfiguration = {
  port: number
  /**
   * @example https://example.com
   */
  backHostUrl: string
  swaggerPass: string
  postgres: TypeOrmModuleOptions
  throttler: ThrottlerModuleOptions
  tron_pro_api_key: string
  infura_api_key: string
  blockcypher_api_key: string
  client_api_url: string
}
