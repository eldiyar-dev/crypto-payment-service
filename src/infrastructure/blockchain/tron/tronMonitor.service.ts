import { Chain, Currency } from '@/common/enums'
import { decodeTrc20Transfer, formatBaseUnits, parseBaseUnits, TRON_USDT_DECIMALS, TRX_DECIMALS, withRetry } from '@/common/utils'
import { ChainCheckpointRepository } from '@/domain/repositories/chainCheckpointRepository'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import { Block } from 'tronweb/lib/esm/types/APIResponse'
import type { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: {
  address: string
  amount: bigint
  decimals: number
  currency: Currency
  txHash: string
  /** Always 0: only contract[0] of a transaction is decoded, so one credit per tx. */
  outputIndex: number
  blockHash?: string | null
  blockNumber?: bigint | null
}) => Promise<void>

@Injectable()
export class TronMonitorService {
  private readonly logger = new Logger(TronMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
    private readonly chainCheckpointRepository: ChainCheckpointRepository,
  ) {}

  private get usdtContractAddress(): string {
    return this.configService.get('tron_usdt_contract_address')!
  }

  private depositCallback: DepositCallback

  private tronWeb: TronWeb
  private lastCheckedBlock = 0
  private readonly pollInterval = 3_000 // 3 seconds

  /**
   * Block depth required before a deposit is acted on.
   *
   * The old check — `currentBlockNumber - blockNum + 1 >= 1` — was always true for any block
   * that had been polled, so it gated nothing and TRON was effectively running at depth 0.
   */
  private get confirmationThreshold(): number {
    return this.configService.get(`confirmations.${Chain.TRON}`, { infer: true })!
  }
  /** Dust thresholds, held as decimal strings and converted to base units at comparison time. */
  private readonly minTrxDeposit = '1' // 1 TRX
  private readonly minUsdtDeposit = '0.5' // 0.5 USDT
  private isPolling = false
  private intervalId: NodeJS.Timeout | null = null

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start(): Promise<void> {
    try {
      this.tronWeb = new TronWeb({ fullHost: this.configService.get('tron_host_url')! })

      // Resume from the durable checkpoint. Resetting to the current block on every boot — as
      // this did — skipped every deposit that arrived during downtime, permanently.
      const checkpoint = await this.chainCheckpointRepository.getLastScannedBlock(Chain.TRON)
      if (checkpoint !== null) {
        this.lastCheckedBlock = checkpoint
        this.logger.log(`Resuming TRON scan from block ${checkpoint + 1}`)
      } else {
        const block = await this.tronWeb.trx.getCurrentBlock()
        this.lastCheckedBlock = block.block_header.raw_data.number
        this.logger.log(`No TRON checkpoint found; starting at current block ${this.lastCheckedBlock}`)
      }

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

      const currentBlockNumber = currentBlock.block_header.raw_data.number

      // Only scan blocks already buried under the confirmation depth. Gating here rather than
      // per-transaction means the depth is actually enforced, and blocks shallower than the
      // threshold are simply left for a later poll.
      const highestConfirmedBlock = currentBlockNumber - this.confirmationThreshold + 1
      if (this.lastCheckedBlock >= highestConfirmedBlock) return

      for (let blockNum = this.lastCheckedBlock + 1; blockNum <= highestConfirmedBlock; blockNum++) {
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

              // O(1) membership test rather than a linear scan of every monitored address.
              if (!(await this.redisService.isKnownAddress(Chain.TRON, toAddress))) continue

              if (trxAmountSun < parseBaseUnits(this.minTrxDeposit, TRX_DECIMALS)) continue

              this.logger.log(`Deposit detected: ${formatBaseUnits(trxAmountSun, TRX_DECIMALS)} TRX to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({
                address: toAddress,
                amount: trxAmountSun,
                decimals: TRX_DECIMALS,
                currency: Currency.TRX,
                txHash: tx.txID,
                outputIndex: 0,
                blockHash: block.blockID,
                blockNumber: BigInt(blockNum),
              })

              continue
            }

            // --- USDT (TRC20) ---
            // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
            if (contract.type === 'TriggerSmartContract') {
              const { contract_address, data } = contract.parameter.value as { contract_address: string; data: string }

              const contractAddress = this.tronWeb.address.fromHex(contract_address)

              // Address of USDT (TRC20) contract on Tron
              if (contractAddress.toLocaleLowerCase() !== this.usdtContractAddress.toLocaleLowerCase()) continue

              // Decoded by argument word rather than by hand-rolled offsets, which got the
              // transferFrom layout wrong and silently missed those deposits entirely.
              const transfer = decodeTrc20Transfer(data)
              if (!transfer) continue

              const toAddress = this.tronWeb.address.fromHex(transfer.toAddressHex)
              const usdtAmountBase = transfer.amount

              // Check if the amount is valid
              if (usdtAmountBase <= 0n) {
                this.logger.warn(`Invalid USDT amount for transaction ${tx.txID}: ${usdtAmountBase}`)
                continue
              }

              if (!(await this.redisService.isKnownAddress(Chain.TRON, toAddress))) continue

              if (usdtAmountBase < parseBaseUnits(this.minUsdtDeposit, TRON_USDT_DECIMALS)) continue

              this.logger.log(`Deposit detected: ${formatBaseUnits(usdtAmountBase, TRON_USDT_DECIMALS)} USDT to ${toAddress} txHash: ${tx.txID}`)

              void this.depositCallback({
                address: toAddress,
                amount: usdtAmountBase,
                decimals: TRON_USDT_DECIMALS,
                currency: Currency.USDT,
                txHash: tx.txID,
                outputIndex: 0,
                blockHash: block.blockID,
                blockNumber: BigInt(blockNum),
              })
            }
          } catch (error) {
            this.logger.error(`Error processing transaction ${tx.txID}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        // Persist only after the block is fully processed: a crash mid-block re-scans it,
        // which the deposit ledger's unique key makes harmless.
        this.lastCheckedBlock = blockNum
        await this.chainCheckpointRepository.setLastScannedBlock(Chain.TRON, blockNum)
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
