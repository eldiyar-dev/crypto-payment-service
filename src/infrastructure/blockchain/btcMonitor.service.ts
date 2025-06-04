import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { TConfiguration } from '../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

type TAddressBalanceEndpoint = {
  address: string
  total_received: number
  total_sent: number
  balance: number
  unconfirmed_balance: number
  final_balance: number
  n_tx: number
  unconfirmed_n_tx: number
  final_n_tx: number
}

type TResponseError = { error: string }

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private readonly baseUrl = 'https://api.blockcypher.com'

  private depositCallback: DepositCallback

  // Список отслеживаемых адресов
  private readonly addresses = [
    'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // Binance
    '3JZq4atUahhuA9rLhXLMhhTo133J9rF97j', // Bitfinex
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Satosh
    '1DEP8i3QJCsomS4BSMY2RpU1upv62aGvhD',
  ]

  private readonly pollIntervalMs = 40_000

  // Храним последние балансы адресов
  private lastBalances: Record<string, number> = {}

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  start() {
    setInterval(() => {
      void this.pollAddresses(this.addresses)
    }, this.pollIntervalMs)
  }

  private async pollAddresses(addressees: string[]) {
    try {
      const url = `${this.baseUrl}/v1/btc/main/addrs/${addressees.join(';')}?token=${this.configService.get('blockcypher_api_key')}`
      const { data: addresses } = await axios.get<Array<TAddressBalanceEndpoint | TResponseError>>(url)

      for (const address of addresses) {
        if ('error' in address) {
          this.logger.error(`Error polling addresses:`, address.error)
          continue
        }

        this.checkDeposit(address.address, address.final_balance)
      }
    } catch (err) {
      this.logger.error(`Error polling addresses:`, err)
    }
  }

  private checkDeposit(address: string, amount: number) {
    const lastBalance = this.lastBalances[address]
    if (!lastBalance) {
      this.lastBalances[address] = amount
      return
    }

    if (amount > lastBalance) {
      this.depositCallback({ address, amount })
    } else if (amount < lastBalance) {
      this.logger.log(`Balance decreased for ${address}: ${lastBalance} → ${amount}`)
      this.lastBalances[address] = amount
    }
  }
}
