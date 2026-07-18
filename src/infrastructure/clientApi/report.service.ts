import { Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosInstance } from 'axios'
import { createClientApiHttp } from './clientApi.http'

type TReportData = {
  currency: Currency
  address: string
  /** Display value. Lossy for wei-precision amounts — see `amountExact`. */
  amount: number
  /**
   * Exact decimal string for money-path reports. Non-monetary reports (e.g. energy counts)
   * omit it.
   */
  amountExact?: string
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

  async sendReport({ currency, address, amount, amountExact, message }: TReportData): Promise<void> {
    try {
      await this.http.post('/api/report', {
        currency,
        address,
        amount,
        amountExact,
        message,
      })
    } catch (error) {
      this.logger.error(`Error sending report for ${address}: ${(error as Error).message}`)
    }
  }
}
