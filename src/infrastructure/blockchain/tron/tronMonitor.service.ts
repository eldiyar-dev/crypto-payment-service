import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits, parseBaseUnits, TRON_USDT_DECIMALS, TRX_DECIMALS, withRetry } from '@/common/utils'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import { Block } from 'tronweb/lib/esm/types/APIResponse'
import type { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: bigint; decimals: number; currency: Currency; txHash: string }) => Promise<void>

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
  /** Dust thresholds, held as decimal strings and converted to base units at comparison time. */
  private readonly minTrxDeposit = '1' // 1 TRX
  private readonly minUsdtDeposit = '0.5' // 0.5 USDT
  private isPolling = false
  private intervalId: NodeJS.Timeout | null = null

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

      this.stop()

      this.intervalId = setInterval(() => {
        void this.pollDeposits()
      }, this.pollInterval)
    } catch (error) {
      this.logger.error(`Error starting Tron monitor ${error.message}`)
    }
  }

  stop() {
    if (!this.intervalId) return

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  private async pollDeposits() {
    if (this.isPolling) return
    this.isPolling = true

    try {
      const currentBlock = await this.getCurrentBlockWithRetry()

      if (!currentBlock) {
        this.logger.error('Error getting current block')
        return
      }

      const addresses = await this.getAddresses()

      const currentBlockNumber = currentBlock.block_header.raw_data.number
      if (this.lastCheckedBlock >= currentBlockNumber) return

      for (let blockNum = this.lastCheckedBlock + 1; blockNum <= currentBlockNumber; blockNum++) {
        const block = await this.getBlockWithRetry(blockNum)
        if (!block?.transactions) {
          this.logger.error(`Block ${blockNum} transactions not found`)
          continue
        }
        this.logger.log(`Processing block ${blockNum}`)

        for (const tx of block.transactions) {
          try {
            if (!Array.isArray(tx?.raw_data?.contract) || !tx.raw_data.contract.length) {
              this.logger.error(`Block ${blockNum} transaction ${tx.txID} has no contract`)
              continue
            }

            // Calculate the number of confirmations
            const confirmations = currentBlockNumber - blockNum + 1
            if (confirmations < this.confirmationThreshold) continue

            const contract = tx.raw_data.contract[0]

            // --- TRX (TransferContract) ---
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (contract.type === 'TransferContract') {
              const { to_address, amount } = contract.parameter.value as { to_address: string; amount: number }

              const toAddress = this.tronWeb.address.fromHex(to_address)

              // `amount` arrives from tronweb already parsed as a JSON number, so anything above
              // 2^53 SUN has lost precision upstream; converting to bigint here at least stops
              // the loss from compounding through the split and the send.
              const trxAmountSun = BigInt(Math.trunc(Number(amount)))

              if (!addresses.includes(toAddress)) continue

              if (trxAmountSun < parseBaseUnits(this.minTrxDeposit, TRX_DECIMALS)) continue

              this.logger.log(`Deposit detected: ${formatBaseUnits(trxAmountSun, TRX_DECIMALS)} TRX to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({ address: toAddress, amount: trxAmountSun, decimals: TRX_DECIMALS, currency: Currency.TRX, txHash: tx.txID })

              continue
            }

            // --- USDT (TRC20) ---
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (contract.type === 'TriggerSmartContract') {
              const { contract_address, data } = contract.parameter.value as { contract_address: string; data: string }

              const contractAddress = this.tronWeb.address.fromHex(contract_address)

              // Address of USDT (TRC20) contract on Tron
              if (contractAddress.toLocaleLowerCase() !== this.usdtContractAddress.toLocaleLowerCase()) continue

              // Check if the method transfer(address,uint256) is called
              const isTransfer = data.startsWith('a9059cbb')
              const isTransferFrom = data.startsWith('23b872dd')

              if (!isTransfer && !isTransferFrom) continue

              // Decode the recipient address
              const toAddressHex = isTransfer ? '41' + data.slice(32, 72) : '41' + data.slice(76, 116)

              const toAddress = this.tronWeb.address.fromHex(toAddressHex)

              // Decode the amount
              const amountHex = data.slice(72, 136)

              if (data.length < 136) {
                this.logger.warn(`Data too short for TRC20 transfer in tx ${tx.txID}`, data)
                continue
              }

              // Exact from the calldata word — BigInt -> Number was lossy above 2^53.
              const usdtAmountBase = BigInt('0x' + amountHex)

              // Check if the amount is valid
              if (usdtAmountBase <= 0n) {
                this.logger.warn(`Invalid USDT amount for transaction ${tx.txID}: ${usdtAmountBase}`)
                continue
              }

              if (!addresses.includes(toAddress)) continue

              if (usdtAmountBase < parseBaseUnits(this.minUsdtDeposit, TRON_USDT_DECIMALS)) continue

              this.logger.log(`Deposit detected: ${formatBaseUnits(usdtAmountBase, TRON_USDT_DECIMALS)} USDT to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({ address: toAddress, amount: usdtAmountBase, decimals: TRON_USDT_DECIMALS, currency: Currency.USDT, txHash: tx.txID })
            }
          } catch (error) {
            this.logger.error(`Error processing transaction ${tx.txID}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        this.lastCheckedBlock = blockNum
      }
    } catch (err: unknown) {
      this.logger.error('Error polling Tron deposits', err)
    } finally {
      this.isPolling = false
    }
  }

  private async getBlockWithRetry(blockNumber: number): Promise<Block | null> {
    return withRetry(() => this.tronWeb.trx.getBlock(blockNumber))
  }

  private async getCurrentBlockWithRetry(): Promise<Block | null> {
    return withRetry(() => this.tronWeb.trx.getCurrentBlock())
  }
}
