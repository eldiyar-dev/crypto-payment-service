import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosInstance } from 'axios'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Builds the axios instance used for every call to the external client API.
 *
 * The client API decides where customer funds go — it returns the destination addresses, the
 * split ratio and the destination hot-wallet key — so the transport is treated as part of the
 * money path:
 *
 * - **TLS is mandatory.** A plain-HTTP `CLIENT_API_URL` is refused at construction time so the
 *   service fails to boot rather than shipping key material in the clear. `ALLOW_INSECURE_CLIENT_API`
 *   exists for local development only.
 * - **Timeouts are explicit.** Without one, a hung client API stalls the serial deposit queue
 *   indefinitely (head-of-line block) and grows it without bound.
 * - **Requests are authenticated** when `CLIENT_API_KEY` is configured, so the peer can identify
 *   this service rather than serving any caller.
 */
export const createClientApiHttp = (configService: ConfigService<TConfiguration>, context: string): AxiosInstance => {
  const logger = new Logger(context)

  const baseUrl = configService.get<TConfiguration['client_api_url']>('client_api_url')
  if (!baseUrl) throw new Error('CLIENT_API_URL is not configured')

  const allowInsecure = configService.get<TConfiguration['allow_insecure_client_api']>('allow_insecure_client_api') ?? false
  if (!baseUrl.startsWith('https://')) {
    if (!allowInsecure) throw new Error(`CLIENT_API_URL must use https (got ${new URL(baseUrl).protocol}); set ALLOW_INSECURE_CLIENT_API=true only for local development`)
    logger.error('SECURITY: client API is being reached over plain HTTP — destination addresses and hot-wallet key material are exposed in transit')
  }

  const apiKey = configService.get<TConfiguration['client_api_key']>('client_api_key')
  if (!apiKey) logger.warn('CLIENT_API_KEY is not configured — requests to the client API are unauthenticated')

  return axios.create({
    baseURL: baseUrl,
    timeout: configService.get<TConfiguration['client_api_timeout_ms']>('client_api_timeout_ms') ?? DEFAULT_TIMEOUT_MS,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  })
}
