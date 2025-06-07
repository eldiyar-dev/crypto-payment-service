import { withRetry } from '@/common/utils/retry.util'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    ;[
      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'.toLowerCase(),
      '0x6E0d01A76C3Cf4288372a29124A26D4353EE51BE'.toLowerCase(),
      '0xF0bAfD58E23726785A1681e1DEa0da15cB038C61'.toLowerCase(),
      '0xfB2C579c1D5f82C7b0f2a3479e5F9bC26bd22b62'.toLowerCase(),
      '0x859C9980931fa0A63765fD8EF2e29918Af5b038C'.toLowerCase(),
      '0x28c6c06298d514db089934071355e5743bf21d60'.toLowerCase(), // Binance
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be'.toLowerCase(), // Binance
      '0xdac17f958d2ee523a2206206994597c13d831ec7'.toLowerCase(), // USDT
      '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2'.toLowerCase(), // FTX
      '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa'.toLowerCase(), // Gemini
    ].forEach((address) => this.addAddress(address))
  }

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
