import { Currency } from '@/common/enums/currency.enum'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

type TDepositData = {
  currency: Currency
  address: string
  amount: number
}

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private get baseUrl() {
    return this.configService.get('client_api_url')
  }

  async notifyNewDeposit({ currency, address, amount }: TDepositData): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/api/new_deposit`, {
        currency,
        address,
        amount,
      })
    } catch (error) {
      this.logger.error(`Error notifying new deposit: ${error}`)
    }
  }
}
