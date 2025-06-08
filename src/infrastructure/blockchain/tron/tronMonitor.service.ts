import { Currency } from '@/common/enums'
import { withRetry } from '@/common/utils'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import { Block } from 'tronweb/lib/esm/types/APIResponse'
import type { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number; currency: Currency }) => Promise<void>

@Injectable()
export class TronMonitorService {
  private readonly logger = new Logger(TronMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private get usdtContractAddress(): string {
    return this.configService.get('tron_usdt_contract_address')!
  }

  private depositCallback: DepositCallback

  private readonly addresses = new Set<string>()

  private tronWeb: TronWeb
  private lastCheckedBlock = 0
  private readonly pollInterval = 10_000 // 1 minute

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

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start(): Promise<void> {
    try {
      this.tronWeb = new TronWeb({
        fullHost: this.configService.get('tron_host_url')!,
        // headers: { 'TRON-PRO-API-KEY': this.configService.get('tron_pro_api_key')! },
      })

      // Get the latest block number at start
      const block = await this.tronWeb.trx.getCurrentBlock()
      this.lastCheckedBlock = block.block_header.raw_data.number

      setInterval(() => {
        void this.pollDeposits()
      }, this.pollInterval)
      // Run immediately
      void this.pollDeposits()
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
        const block = await this.getBlockWithRetry(blockNum)
        if (!block?.transactions) continue

        for (const tx of block.transactions) {
          if (!tx.raw_data.contract.length || !tx.raw_data.contract) continue

          const contract = tx.raw_data.contract[0]

          // --- TRX (TransferContract) ---
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          if (contract.type === 'TransferContract') {
            const { to_address, amount } = contract.parameter.value as { to_address: string; amount: number }

            const toAddress = this.tronWeb.address.fromHex(to_address)

            const trxAmount = Number(amount) / 1e6

            if (!this.getAddresses.includes(toAddress)) continue

            if (trxAmount < 0.001) continue

            this.logger.log(`Deposit detected: ${trxAmount} TRX to ${toAddress}`)

            void this.depositCallback({ address: toAddress, amount: trxAmount, currency: Currency.TRX })

            continue
          }

          // --- USDT (TRC20) ---
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          if (contract.type === 'TriggerSmartContract') {
            const { contract_address, data } = contract.parameter.value as { contract_address: string; data: string }

            const contractAddress = this.tronWeb.address.fromHex(contract_address)

            // Address of USDT (TRC20) contract on Tron
            if (contractAddress !== this.usdtContractAddress) continue

            // Check if the method transfer(address,uint256) is called
            if (!data?.startsWith('a9059cbb')) continue

            // Decode the recipient address
            const toAddressHex = '41' + data.slice(8 + 24, 8 + 64)

            const toAddress = this.tronWeb.address.fromHex(toAddressHex)

            // Decode the amount
            const amountHex = data.slice(8 + 64, 8 + 128)

            const usdtAmount = parseInt(amountHex, 16) / 1e6 // 6 decimal places

            if (!this.getAddresses.includes(toAddress)) continue

            if (usdtAmount < 0.001) continue

            this.logger.log(`Deposit detected: ${usdtAmount} USDT to ${toAddress}`)

            void this.depositCallback({ address: toAddress, amount: usdtAmount, currency: Currency.USDT })
          }
        }
      }

      this.lastCheckedBlock = currentBlockNumber
    } catch (err: unknown) {
      this.logger.error('Error polling Tron deposits', err)
    }
  }

  private async getBlockWithRetry(blockNumber: number): Promise<Block | null> {
    return withRetry(() => this.tronWeb.trx.getBlock(blockNumber))
  }
}
