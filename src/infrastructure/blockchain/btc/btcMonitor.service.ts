import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  // Blockstream API base URL
  private readonly baseUrl = 'https://blockstream.info/api'

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

  getAddresses(): string[] {
    return Array.from(this.addresses)
  }

  start() {
    setInterval(() => {
      void this.pollAddresses(this.getAddresses())
    }, this.pollIntervalMs)
    // Run immediately
    void this.pollAddresses(this.getAddresses())
  }

  private async pollAddresses(addresses: string[]) {
    for (const address of addresses) {
      try {
        const url = `${this.baseUrl}/address/${address}`
        const { data } = await axios.get(url)
        // Blockstream API: balance = funded_txo_sum - spent_txo_sum
        const funded = data.chain_stats.funded_txo_sum
        const spent = data.chain_stats.spent_txo_sum
        const finalBalance = funded - spent
        this.checkDeposit(address, finalBalance)
      } catch (err) {
        this.logger.error(`Error polling address ${address}:`, (err as Error).message)
      }
    }
  }

  private checkDeposit(address: string, finalBalance: number) {
    const lastBalance = this.lastBalances[address]
    if (lastBalance === undefined) {
      this.lastBalances[address] = finalBalance
      return
    }

    if (finalBalance > lastBalance) {
      const amount = finalBalance - lastBalance
      this.logger.log(`Deposit detected: to ${address}, amount ${amount} sats`)
      this.depositCallback({ address, amount })
      this.lastBalances[address] = finalBalance
    } else if (finalBalance < lastBalance) {
      this.logger.log(`Balance decreased for ${address}: ${lastBalance} → ${finalBalance}`)
      this.lastBalances[address] = finalBalance
    }
  }
}
