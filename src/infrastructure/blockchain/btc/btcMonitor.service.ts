import { Chain } from '@/common/enums'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { BtcInfoService } from './btcInfo.service'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly btcInfoService: BtcInfoService,
  ) {}

  private depositCallback: DepositCallback

  private readonly pollIntervalMs = 30_000

  private lastBalances: Record<string, number> = {}

  private readonly getLastBalance = (address: string) => {
    const balance = this.lastBalances[address]
    if (balance === null || balance === undefined) this.setLastBalance(address, 0)
    return this.lastBalances[address]
  }

  private readonly setLastBalance = (address: string, balance: number) => {
    this.lastBalances[address] = balance
  }

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
        const balance = await this.btcInfoService.getBTCBalance('C2nT3QBWBc6haKu7hwjSxjaV5QV6VXUv2d')
        if (!balance) continue

        this.checkDeposit(address, balance)
      } catch (err) {
        this.logger.error(`Error polling address ${address}: ${err.message}`)
      }
    }
  }

  private checkDeposit(address: string, balance: number) {
    // If the balance is less than 0.00001 BTC, do nothing
    if (balance < 0.00001) return

    const lastBalance = this.getLastBalance(address)

    // If the balance has not changed, do nothing
    if (balance === lastBalance) return

    this.logger.log(`Deposit detected: to ${address}, amount ${balance} BTC`)
    this.depositCallback({ address, amount: balance })

    this.setLastBalance(address, balance)
  }
}
