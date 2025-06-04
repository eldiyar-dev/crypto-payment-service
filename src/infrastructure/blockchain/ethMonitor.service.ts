import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { TConfiguration } from '../config/configuration'

type DepositCallback = (data: { address: string; amount: number }) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private depositCallback: DepositCallback

  private readonly addresses = [
    '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'.toLowerCase(),
    '0x6E0d01A76C3Cf4288372a29124A26D4353EE51BE'.toLowerCase(),
    '0xF0bAfD58E23726785A1681e1DEa0da15cB038C61'.toLowerCase(),
    '0xfB2C579c1D5f82C7b0f2a3479e5F9bC26bd22b62'.toLowerCase(),
    '0x859C9980931fa0A63765fD8EF2e29918Af5b038C'.toLowerCase(),
  ]

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
    const block = await this.provider.getBlock(blockNumber)
    if (!block) return

    for (const txHash of block.transactions) {
      try {
        const tx = await this.provider.getTransaction(txHash)
        if (!tx?.to) continue

        const to = tx.to.toLowerCase()
        if (!this.addresses.includes(to)) continue

        const amountEth = Number(ethers.formatEther(tx.value))

        this.logger.log(`Deposit detected: to ${to}, amount ${amountEth} ETH`)

        this.depositCallback({ address: to, amount: amountEth })
      } catch (err) {
        this.logger.error('Error processing transaction', (err as Error).message)
      }
    }
  }
}
