import { Chain, Currency } from '@/common/enums'
import { withRetry } from '@/common/utils'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import { Block } from 'tronweb/lib/esm/types/APIResponse'
import type { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number; currency: Currency; txHash: string }) => Promise<void>

@Injectable()
export class TronMonitorService {
  private readonly logger = new Logger(TronMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  private get usdtContractAddress(): string {
    return this.configService.get('tron_usdt_contract_address')!
  }

  private depositCallback: DepositCallback

  private tronWeb: TronWeb
  private lastCheckedBlock = 0
  private readonly pollInterval = 3_000 // 3 seconds
  private readonly confirmationThreshold = 1 // 1 confirmations
  private readonly minTrxDeposit = 1 // 1 TRX
  private readonly minUsdtDeposit = 0.5 // 0.5 USDT

  async getAddresses(): Promise<string[]> {
    return this.redisService.getAddresses(Chain.TRON)
  }

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start(): Promise<void> {
    try {
      this.tronWeb = new TronWeb({ fullHost: this.configService.get('tron_host_url')! })

      // Get the latest block number at start
      const block = await this.tronWeb.trx.getCurrentBlock()
      this.lastCheckedBlock = block.block_header.raw_data.number

      setInterval(() => {
        void this.pollDeposits()
      }, this.pollInterval)
    } catch (error) {
      this.logger.error(`Error starting Tron monitor ${error.message}`)
    }
  }

  private async pollDeposits() {
    try {
      const currentBlock = await this.getCurrentBlockWithRetry()

      if (!currentBlock) {
        this.logger.error('Error getting current block')
        return
      }

      const currentBlockNumber = currentBlock.block_header.raw_data.number
      if (this.lastCheckedBlock >= currentBlockNumber) return

      for (let blockNum = this.lastCheckedBlock + 1; blockNum <= currentBlockNumber; blockNum++) {
        const block = await this.getBlockWithRetry(blockNum)
        if (!block?.transactions) continue

        for (const tx of block.transactions) {
          try {
            if (!tx.raw_data.contract.length || !tx.raw_data.contract) continue

            // Calculate the number of confirmations
            const confirmations = currentBlockNumber - blockNum + 1
            if (confirmations < this.confirmationThreshold) continue

            const contract = tx.raw_data.contract[0]

            // --- TRX (TransferContract) ---
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (contract.type === 'TransferContract') {
              const { to_address, amount } = contract.parameter.value as { to_address: string; amount: number }

              const toAddress = this.tronWeb.address.fromHex(to_address)

              const trxAmount = Number(amount) / 1e6

              if (!(await this.getAddresses()).includes(toAddress)) continue

              if (trxAmount < this.minTrxDeposit) continue

              this.logger.log(`Deposit detected: ${trxAmount} TRX to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({ address: toAddress, amount: trxAmount, currency: Currency.TRX, txHash: tx.txID })

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
              const isTransfer = data.startsWith('a9059cbb')
              const isTransferFrom = data.startsWith('23b872dd')

              if (!isTransfer && !isTransferFrom) continue

              // Decode the recipient address
              const toAddressHex = isTransfer ? '41' + data.slice(32, 72) : '41' + data.slice(76, 116)

              const toAddress = this.tronWeb.address.fromHex(toAddressHex)

              // Decode the amount
              const amountHex = data.slice(72, 136)

              const amountBigInt = BigInt('0x' + amountHex)
              const usdtAmount = Number(amountBigInt) / 1e6

              // Check if the amount is valid
              if (isNaN(usdtAmount) || usdtAmount <= 0) {
                this.logger.warn(`Invalid USDT amount for transaction ${tx.txID}: ${usdtAmount}`)
                continue
              }

              if (!(await this.getAddresses()).includes(toAddress)) continue

              if (usdtAmount < this.minUsdtDeposit) continue

              this.logger.log(`Deposit detected: ${usdtAmount} USDT to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({ address: toAddress, amount: usdtAmount, currency: Currency.USDT, txHash: tx.txID })
            }
          } catch (error) {
            this.logger.error(`Error processing transaction ${tx.txID}: ${error.message}`)
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

  private async getCurrentBlockWithRetry(): Promise<Block | null> {
    return withRetry(() => this.tronWeb.trx.getCurrentBlock())
  }
}
