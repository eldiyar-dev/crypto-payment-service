import { Chain } from '@/common/enums'
import { isEvmNetwork, isValidChainAddress } from '@/common/utils'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosInstance } from 'axios'
import { createClientApiHttp } from './clientApi.http'

type TWithdrawWalletsResponseData = {
  mainAddress: string
  mainPrivateKey: string
  additionalAddress: string
  pie: number
}
type TWithdrawWalletsResponse = {
  mainAddress: string
  mainSecret: string
  additionalAddress: string
  pie: number
}

@Injectable()
export class WithdrawService implements OnModuleInit {
  private readonly logger = new Logger(WithdrawService.name)

  private http: AxiosInstance

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  onModuleInit() {
    this.http = createClientApiHttp(this.configService, WithdrawService.name)
  }

  /**
   * Fetches the destination wallets and split ratio for a deposit.
   *
   * This response fully determines where customer funds go, so it is validated before use:
   * a malformed destination address is an irrecoverable send, and an out-of-range `pie`
   * silently produces NaN or negative legs downstream. Anything that fails validation is
   * rejected outright rather than partially applied.
   *
   * @returns The validated withdraw data, or null if the call or validation failed
   */
  async getWithdrawWallets(chain: Chain, address: string): Promise<TWithdrawWalletsResponseData | null> {
    try {
      this.logger.log(`Getting withdraw wallets for ${address} on ${chain}`)

      const response = await this.http.get<TWithdrawWalletsResponse>('/api/withdraw_wallets/', {
        params: { currency: isEvmNetwork(chain) ? Chain.ETH : chain, address },
      })

      return this.validate(response.data, chain, address)
    } catch (error) {
      // Log the message only — the full axios error serialises the response body, which is
      // where mainSecret lives.
      this.logger.error(`Error getting withdraw wallets for ${address} on ${chain}: ${(error as Error).message}`)
      return null
    }
  }

  private validate(data: TWithdrawWalletsResponse | undefined, chain: Chain, address: string): TWithdrawWalletsResponseData | null {
    const reject = (reason: string): null => {
      this.logger.error(`Rejecting withdraw_wallets response for ${address} on ${chain}: ${reason}`)
      return null
    }

    if (!data || typeof data !== 'object') return reject('response body is not an object')

    const { mainAddress, additionalAddress, mainSecret, pie } = data

    if (!isValidChainAddress(mainAddress, chain)) return reject(`mainAddress is not a valid ${chain} address`)
    if (!isValidChainAddress(additionalAddress, chain)) return reject(`additionalAddress is not a valid ${chain} address`)
    if (typeof mainSecret !== 'string' || !mainSecret.length) return reject('mainSecret is missing')
    if (typeof pie !== 'number' || !Number.isFinite(pie) || pie < 0 || pie > 100) return reject(`pie must be a finite number in [0, 100], got ${String(pie)}`)

    return { mainAddress, additionalAddress, pie, mainPrivateKey: mainSecret }
  }
}
