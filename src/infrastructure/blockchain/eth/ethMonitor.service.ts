import { withRetry } from '@/common/utils/retry.util'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private depositCallback: DepositCallback

  private readonly addresses = new Set<string>()

  addAddress(address: string) {
    this.addresses.add(address.toLowerCase())
    this.logger.log(`Added address ${address} to monitor`)
  }

  get getAddresses(): string[] {
    return Array.from(this.addresses)
  }

  removeAddress(address: string) {
    this.addresses.delete(address)
  }

  private provider: ethers.WebSocketProvider

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  async start() {
    this.provider = new ethers.WebSocketProvider(`wss://mainnet.infura.io/ws/v3/${this.configService.get('infura_api_key')}`)
    await this.listen()
  }

  private async listen() {
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
        const tx = await this.getTransactionWithRetry(txHash)
        if (!tx?.to) continue

        const to = tx.to.toLowerCase()
        if (!this.getAddresses.includes(to)) continue

        const amountEth = Number(ethers.formatEther(tx.value))
        if (!amountEth) continue

        this.logger.log(`Deposit detected: ${amountEth} ETH to ${to}`)
        this.depositCallback({ address: to, amount: amountEth })
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
}
