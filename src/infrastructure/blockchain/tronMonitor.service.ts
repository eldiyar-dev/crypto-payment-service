import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import type { TConfiguration } from '../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class TronMonitorService {
  private readonly logger = new Logger(TronMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private depositCallback: DepositCallback

  private readonly addresses = ['TUR6iqkZjsf6CXMg3bm5g9sBFZSLhmSjvm']

  private tronWeb: TronWeb
  private lastCheckedBlock = 0
  private readonly pollInterval = 10_000 // 10 seconds

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start(): Promise<void> {
    try {
      this.tronWeb = new TronWeb({
        fullNode: 'https://api.trongrid.io',
        solidityNode: 'https://api.trongrid.io',
        eventServer: 'https://api.trongrid.io',
        headers: { 'TRON-PRO-API-KEY': this.configService.get('tron_pro_api_key')! },
      })

      // Get the latest block number at start
      const block = await this.tronWeb.trx.getCurrentBlock()
      this.lastCheckedBlock = block.block_header.raw_data.number

      setInterval(() => {
        void this.pollDeposits()
      }, this.pollInterval)
    } catch (error: unknown) {
      this.logger.error('Error starting Tron monitor', error)
    }
  }

  private async pollDeposits() {
    try {
      const currentBlock = await this.tronWeb.trx.getConfirmedCurrentBlock()
      const currentBlockNumber = currentBlock.block_header.raw_data.number
      if (this.lastCheckedBlock >= currentBlockNumber) return

      for (let blockNum = this.lastCheckedBlock + 1; blockNum <= currentBlockNumber; blockNum++) {
        const block = await this.tronWeb.trx.getBlock(blockNum)
        if (!block.transactions) continue

        for (const tx of block.transactions) {
          if (!tx.raw_data.contract.length || !tx.raw_data.contract) continue

          const contract = tx.raw_data.contract[0]

          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          if (contract.type !== 'TransferContract') continue

          const { to_address, amount } = contract.parameter.value as { to_address: string; amount: number }
          const toAddress = this.tronWeb.address.fromHex(to_address)

          if (!this.addresses.includes(toAddress)) continue

          this.logger.log(`Deposit detected: ${amount / 1e6} TRX to ${toAddress}`)

          this.depositCallback({
            address: toAddress,
            amount: amount / 1e6, // TRX has 6 decimals
          })
        }
      }
      this.lastCheckedBlock = currentBlockNumber
    } catch (err: unknown) {
      this.logger.error('Error polling Tron deposits', err)
    }
  }
}
