import { Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

type TReportData = {
  currency: Currency
  address: string
  amount: number
  message: string
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private get baseUrl() {
    return this.configService.get('client_api_url')
  }

  async sendReport({ currency, address, amount, message }: TReportData): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/api/report`, {
        currency,
        address,
        amount,
        message,
      })
    } catch (error) {
      this.logger.error(`Error sending report: ${error.message}`, error)
    }
  }
}
