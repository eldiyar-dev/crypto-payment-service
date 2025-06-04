import { Currency } from '@/common/enums/currency.enum'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

type TWithdrawWalletsResponseData = {
  mainAddress: string
  mainPrivateKey: string
  additionalAddress: string
  pie: number
}

@Injectable()
export class WithdrawService {
  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  async getWithdrawWallets(currency: Currency, address: string) {
    const baseUrl = this.configService.get('client_api_url')
    const response = await axios.get<TWithdrawWalletsResponseData>(`${baseUrl}/api/withdraw_wallets/`, {
      params: { currency, address },
    })
    return response.data
  }
}
