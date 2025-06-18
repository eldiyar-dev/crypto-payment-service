import { Chain } from '@/common/enums'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BtcInfoService } from './btcInfo.service'

type DepositCallback = (data: { address: string; amount: number }) => void

type Transaction = {
  event?: string
  block_height: number
  block_index: number
  hash: string
  addresses: string[]
  total: number
  fees: number
  size: number
  vsize: number
  preference: string
  relayed_by: string
  received: string
  ver: number
  double_spend: boolean
  vin_sz: number
  vout_sz: number
  confirmations: number
  inputs: Input[]
  outputs: Output[]
}

interface Input {
  prev_hash: string
  output_index: number
  output_value: number
  sequence: number
  addresses: string[]
  script_type: string
  age: number
  witness: string[]
}

interface Output {
  value: number
  script: string
  addresses: string[]
  script_type: string
}

@Injectable()
export class BtcMonitorService {
  private readonly logger = new Logger(BtcMonitorService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly btcInfoService: BtcInfoService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {
    this.btcWssUrl = `${this.configService.get('btc_wss_url')}?token=${this.configService.get('blockcypher_api_key')}`
  }

  private readonly btcWssUrl: string

  private depositCallback: DepositCallback

  // private readonly pollIntervalMs = 30_000
  private readonly confirmationsThreshold = 2
  // private readonly confirmationsCheckIntervalMs = 30_000

  private readonly pendingDeposits: Record<string, { address: string; value: number }> = {}

  // private lastBalances: Record<string, number> = {}

  // private readonly getLastBalance = (address: string) => {
  //   const balance = this.lastBalances[address]
  //   if (balance === null || balance === undefined) this.setLastBalance(address, 0)
  //   return this.lastBalances[address]
  // }

  // private readonly setLastBalance = (address: string, balance: number) => {
  //   this.lastBalances[address] = balance
  // }

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  addAddress(address: string) {
    try {
      this.websocketSubscribe(address)
      this.logger.log(`Added address ${address} to monitor`)
    } catch (error) {
      this.logger.error(`Error adding address ${address} to monitor ${error.message}`)
    }
  }

  async getAddresses(): Promise<string[]> {
    return this.redisService.getAddresses(Chain.BTC)
  }

  async start() {
    // setInterval(async () => {
    //   void this.pollAddresses(await this.getAddresses())
    // }, this.pollIntervalMs)
    // // Run immediately
    // void this.pollAddresses(await this.getAddresses())

    const addresses = await this.getAddresses()
    for (const address of addresses) {
      this.websocketSubscribe(address)
    }
  }

  websocketSubscribe(address: string) {
    const ws = new WebSocket(this.btcWssUrl)

    ws.onopen = () => {
      this.logger.log(`Websocket connected for ${address}`)
      ws.send(JSON.stringify({ event: 'tx-confirmation', address }))
    }

    ws.onmessage = (event) => {
      const tx: Transaction = JSON.parse(event.data as string) as Transaction

      if (tx.event === 'pong') return

      if (tx.event) this.logger.log(`Event: ${tx.event}`)

      if (!tx?.outputs) return

      if (tx.confirmations < this.confirmationsThreshold) return

      const depositBTC = this.parseDepositsByAddress(tx, address)
      if (depositBTC < 0.00005) return

      this.logger.log(`Deposit detected: ${depositBTC} BTC`)
      this.depositCallback({ address, amount: depositBTC })
    }

    // Send ping every 20 seconds to keep connection alive
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'ping' }))
      }
    }, 20_000)
  }

  private parseDepositsByAddress(tx: Transaction, targetAddress: string): number {
    let depositSatoshi = 0

    for (const output of tx.outputs) {
      if (!output.addresses?.length) continue

      if (!output.addresses.includes(targetAddress)) continue

      depositSatoshi += output.value
    }

    const depositBTC = depositSatoshi / 1e8

    return depositBTC
  }

  // private async waitForConfirmations(txid: string) {
  //   try {
  //     const url = `${this.configService.get('btc_api_url')}/txs/${txid}?token=${this.configService.get('blockcypher_api_key')}`
  //     const resp = await axios.get(url)
  //     const confirmations = resp.data.confirmations
  //     if (confirmations >= this.confirmationsThreshold) {
  //       const deposit = this.pendingDeposits[txid]
  //       if (deposit) {
  //         const amountBTC = deposit.value / 1e8
  //         this.logger.log(`Deposit confirmed: to ${deposit.address}, amount ${amountBTC} BTC, txid: ${txid}`)
  //         if (this.depositCallback) {
  //           this.depositCallback({ address: deposit.address, amount: amountBTC })
  //         }
  //         delete this.pendingDeposits[txid]
  //       }
  //     } else setTimeout(() => this.waitForConfirmations(txid), this.confirmationsCheckIntervalMs)
  //   } catch (e) {
  //     this.logger.error(`Error checking confirmations for tx ${txid}: ${e.message}`)
  //     setTimeout(() => this.waitForConfirmations(txid), this.confirmationsCheckIntervalMs)
  //   }
  // }

  // private async pollAddresses(addresses: string[]) {
  //   for (const address of addresses) {
  //     try {
  //       const balance = await this.btcInfoService.getBTCBalance(address)
  //       if (!balance) continue

  //       this.checkDeposit(address, balance)
  //     } catch (err) {
  //       this.logger.error(`Error polling address ${address}: ${err.message}`)
  //     }
  //   }
  // }

  // private checkDeposit(address: string, balance: number) {
  //   // If the balance is less than 0.0001 BTC, do nothing
  //   if (balance < 0.0001) return

  //   const lastBalance = this.getLastBalance(address)

  //   // If the balance has not changed, do nothing
  //   if (balance === lastBalance) return

  //   this.logger.log(`Deposit detected: to ${address}, amount ${balance} BTC`)
  //   this.depositCallback({ address, amount: balance })

  //   this.setLastBalance(address, balance)
  // }
}
