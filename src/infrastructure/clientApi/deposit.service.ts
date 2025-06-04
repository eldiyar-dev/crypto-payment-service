import { Currency } from '@/common/enums/currency.enum'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

type TDepositData = {
  currency: Currency
  address: string
  amount: number
}

@Injectable()
export class DepositService {
  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  async notifyNewDeposit({ currency, address, amount }: TDepositData): Promise<void> {
    const baseUrl = this.configService.get('client_api_url')
    await axios.post(`${baseUrl}/api/new_deposit`, {
      currency,
      address,
      amount,
    })
  }
}
