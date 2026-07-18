import { Chain, Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosInstance } from 'axios'
import { createClientApiHttp } from './clientApi.http'

type TDepositData = {
  currency: Currency
  address: string
  amount: number
  txHash?: string
  chain: Chain
}

@Injectable()
export class DepositService implements OnModuleInit {
  private readonly logger = new Logger(DepositService.name)

  private http: AxiosInstance

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  onModuleInit() {
    this.http = createClientApiHttp(this.configService, DepositService.name)
  }

  async notifyNewDeposit({ currency, address, amount, txHash, chain }: TDepositData): Promise<void> {
    try {
      await this.http.post('/api/new_deposit', {
        currency,
        address,
        amount,
        txHash,
        chain,
      })
    } catch (error) {
      this.logger.error(`Error notifying new deposit for ${address}: ${(error as Error).message}`)
    }
  }
}
