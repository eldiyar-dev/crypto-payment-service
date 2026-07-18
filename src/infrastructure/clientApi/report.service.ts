import { Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosInstance } from 'axios'
import { createClientApiHttp } from './clientApi.http'

type TReportData = {
  currency: Currency
  address: string
  amount: number
  message: string
}

@Injectable()
export class ReportService implements OnModuleInit {
  private readonly logger = new Logger(ReportService.name)

  private http: AxiosInstance

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  onModuleInit() {
    this.http = createClientApiHttp(this.configService, ReportService.name)
  }

  async sendReport({ currency, address, amount, message }: TReportData): Promise<void> {
    try {
      await this.http.post('/api/report', {
        currency,
        address,
        amount,
        message,
      })
    } catch (error) {
      this.logger.error(`Error sending report for ${address}: ${(error as Error).message}`)
    }
  }
}
