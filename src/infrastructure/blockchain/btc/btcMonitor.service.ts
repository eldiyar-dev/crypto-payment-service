import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { TConfiguration } from '../../config/configuration'

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

  private readonly addresses = new Set<string>()

  private readonly pollIntervalMs = 60_000

  private lastBalances: Record<string, number> = {}

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  addAddress(address: string) {
    this.addresses.add(address)
    this.logger.log(`Added address ${address} to monitor`)
  }

  removeAddress(address: string) {
    this.addresses.delete(address)
  }

  get getAddresses(): string[] {
    return Array.from(this.addresses)
  }

  start() {
    setInterval(() => {
      void this.pollAddresses(this.getAddresses)
    }, this.pollIntervalMs)
    // Run immediately
    void this.pollAddresses(this.getAddresses)
  }

  private async pollAddresses(addressees: string[]) {
    try {
      const url = `${this.baseUrl}/v1/btc/main/addrs/${addressees.join(';')}?token=${this.configService.get('blockcypher_api_key')}`
      const { data: addresses } = await axios.get<Array<TAddressBalanceEndpoint | TResponseError>>(url)

      for (const address of addresses) {
        if ('error' in address) {
          this.logger.error(`Error polling address:`, address.error)
          continue
        }

        this.checkDeposit(address.address, address.final_balance)
      }
    } catch (err) {
      this.logger.error(`Error polling addresses:`, (err as Error).message)
    }
  }

  private checkDeposit(address: string, finalBalance: number) {
    const lastBalance = this.lastBalances[address]
    if (!lastBalance) {
      this.lastBalances[address] = finalBalance
      return
    }

    if (finalBalance > lastBalance) {
      const amount = finalBalance - lastBalance
      this.logger.log(`Deposit detected: to ${address}, amount ${amount} BTC`)
      this.depositCallback({ address, amount })
    } else if (finalBalance < lastBalance) {
      this.logger.log(`Balance decreased for ${address}: ${lastBalance} → ${finalBalance}`)
      this.lastBalances[address] = finalBalance
    }
  }
}
