import { Chain } from '@/common/enums'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { TConfiguration } from '../../config/configuration'
type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  // Blockstream API base URL
  private readonly baseUrl = 'https://blockstream.info/api'

  private depositCallback: DepositCallback

  private readonly pollIntervalMs = 60_000

  private lastBalances: Record<string, number> = {}

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async addAddress(address: string) {
    try {
      await this.redisService.addAddress(Chain.BTC, address)
      this.logger.log(`Added address ${address} to monitor`)
    } catch (error) {
      this.logger.error(`Error adding address ${address} to monitor ${error.message}`)
    }
  }

  async getAddresses(): Promise<string[]> {
    return this.redisService.getAddresses(Chain.BTC)
  }

  async start() {
    setInterval(async () => {
      void this.pollAddresses(await this.getAddresses())
    }, this.pollIntervalMs)
    // Run immediately
    void this.pollAddresses(await this.getAddresses())
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
