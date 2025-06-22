import { Chain, Currency } from '@/common/enums'
import { withRetry } from '@/common/utils'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ContractEventPayload, ethers } from 'ethers'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number; currency: Currency; txHash: string }) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  private readonly minEthDeposit = 0.001 // 0.001 ETH

  private depositCallback: DepositCallback

  async getAddresses(): Promise<string[]> {
    const addresses = await this.redisService.getAddresses(Chain.ETH)
    return addresses.map((address) => address.toLowerCase())
  }

  private provider: ethers.WebSocketProvider
  private usdtContract: ethers.Contract

  // ERC20 ABI for Transfer event
  private readonly ERC20_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)']

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  start() {
    this.provider = new ethers.WebSocketProvider(`${this.configService.get('eth_wss_url')}`)

    void this.listenEthTransfers()
    void this.listenUsdtTransfers()
  }

  private async listenEthTransfers() {
    await this.provider.on('block', async (blockNumber: number) => {
      try {
        await this.checkBlockForDeposits(blockNumber)
      } catch (err) {
        this.logger.error('Error processing block', err)
      }
    })
  }

  private async checkBlockForDeposits(blockNumber: number) {
    const block = await this.getBlockWithRetry(blockNumber)
    if (!block) return

    for (const txHash of block.transactions) {
      try {
        if (await this.redisService.isFeeTransactionHash(txHash)) {
          this.logger.log(`Ignoring fee transaction: ${txHash}`)
          continue
        }

        const tx = await this.getTransactionWithRetry(txHash)
        if (!tx?.to) continue

        const to = tx.to.toLowerCase()
        if (!(await this.getAddresses()).includes(to)) continue

        const amountEth = Number(ethers.formatEther(tx.value))
        if (amountEth < this.minEthDeposit) continue

        this.logger.log(`Deposit detected: ${amountEth} ETH to ${to} txHash: ${txHash}`)
        this.depositCallback({ address: to, amount: amountEth, currency: Currency.ETH, txHash })
      } catch (err) {
        this.logger.error('Error processing transaction', (err as Error).message)
      }
    }
  }

  private async getTransactionWithRetry(txHash: string): Promise<ethers.TransactionResponse | null> {
    return withRetry(() => this.provider.getTransaction(txHash))
  }

  private async getBlockWithRetry(blockNumber: number): Promise<ethers.Block | null> {
    return withRetry(() => this.provider.getBlock(blockNumber))
  }

  private async listenUsdtTransfers() {
    this.usdtContract = new ethers.Contract(this.configService.get('eth_usdt_contract_address')!, this.ERC20_ABI, this.provider)

    await this.usdtContract.on('Transfer', async (from: string, to: string, value: ethers.BigNumberish, event: ContractEventPayload) => {
      try {
        const toLower = to.toLowerCase()
        if (!(await this.getAddresses()).includes(toLower)) return

        // USDT has 6 decimals
        const amountUsdt = Number(ethers.formatUnits(value, 6))
        if (!amountUsdt) return

        const txHash = event.log.transactionHash

        this.logger.log(`Deposit detected: ${amountUsdt} USDT to ${toLower} txHash: ${txHash}`)
        this.depositCallback({ address: toLower, amount: amountUsdt, currency: Currency.USDT, txHash })
      } catch (err) {
        this.logger.error('Error processing USDT transfer', (err as Error).message)
      }
    })
  }
}
