import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits, toDisplayNumber } from '@/common/utils'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosInstance } from 'axios'
import { createClientApiHttp } from './clientApi.http'

type TDepositData = {
  currency: Currency
  address: string
  /** Amount in base units. Exact. */
  amount: bigint
  /** Decimal places for `amount`. */
  decimals: number
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

  /**
   * Notifies the client API of a confirmed deposit.
   *
   * `amount` is kept as a JSON number for wire compatibility, but a JSON number cannot represent
   * a wei-precision value exactly, so the authoritative `amountExact` decimal string and
   * `amountBaseUnits`/`decimals` are sent alongside it. Consumers should prefer the exact fields.
   */
  async notifyNewDeposit({ currency, address, amount, decimals, txHash, chain }: TDepositData): Promise<void> {
    try {
      await this.http.post('/api/new_deposit', {
        currency,
        address,
        amount: toDisplayNumber(amount, decimals),
        amountExact: formatBaseUnits(amount, decimals),
        amountBaseUnits: amount.toString(),
        decimals,
        txHash,
        chain,
      })
    } catch (error) {
      this.logger.error(`Error notifying new deposit for ${address}: ${(error as Error).message}`)
    }
  }
}
