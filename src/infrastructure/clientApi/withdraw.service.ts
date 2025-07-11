import { Chain } from '@/common/enums'
import { isEvmNetwork } from '@/common/utils'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

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
export class WithdrawService {
  private readonly logger = new Logger(WithdrawService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  async getWithdrawWallets(chain: Chain, address: string): Promise<TWithdrawWalletsResponseData | null> {
    try {
      this.logger.log(`Getting withdraw wallets for ${address} on ${chain}`)
      const baseUrl = this.configService.get('client_api_url')
      const response = await axios.get<TWithdrawWalletsResponse>(`${baseUrl}/api/withdraw_wallets/`, {
        params: { currency: isEvmNetwork(chain) ? Chain.ETH : chain, address },
      })
      return {
        ...response.data,
        mainPrivateKey: response.data.mainSecret,
      }
    } catch (error) {
      this.logger.error(`Error getting withdraw wallets: ${error.message}`, error)
      return null
    }
  }
}
