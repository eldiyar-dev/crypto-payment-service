import { Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type TWithdrawWalletsResponseData = {
  mainAddress: string
  mainPrivateKey: string
  additionalAddress: string
  pie: number
}

@Injectable()
export class WithdrawService {
  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  async getWithdrawWallets(currency: Currency, address: string): Promise<TWithdrawWalletsResponseData> {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return {
      additionalAddress: 'TWX27NPThSd4MWfQ6bpX6NfuHK6tdiB8dJ',
      mainAddress: 'TTuZtfBV6YYuWmemQky5YnpqgQYV7NACac',
      mainPrivateKey: 'C7A1C54A449C5EFBEB72D41C4022C345183443BB56843A3C93DD9EC1C0D145DE',
      pie: 80,
    }
    // const baseUrl = this.configService.get('client_api_url')
    // const response = await axios.get<TWithdrawWalletsResponseData>(`${baseUrl}/api/withdraw_wallets/`, {
    //   params: { currency, address },
    // })
    // return response.data
  }
}
