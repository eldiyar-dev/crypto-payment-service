import { AnkrAddress, AnkrBlock, AnkrStatus, AnkrTransaction } from '@/common/interfaces'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios, { AxiosError } from 'axios'

@Injectable()
export class BtcInfoService {
  private readonly logger = new Logger(BtcInfoService.name)
  private readonly baseUrl: string

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.baseUrl = this.configService.get('btc_api_url')!
  }

  async getBTCBalance(address: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/api/v2/address/${address}`
      const { data } = await axios.get<AnkrAddress>(url)
      return data.balance ? parseInt(data.balance, 10) / 1e8 : 0
    } catch (error) {
      this.logger.error(`Failed to get BTC balance for address ${address}: ${(error as Error).message}`)
      return null
    }
  }

  async getLatestBlockHeight(): Promise<number> {
    try {
      const url = `${this.baseUrl}/api/v2/`
      const { data } = await axios.get<AnkrStatus>(url)
      return data.blockbook.bestHeight
    } catch (error) {
      this.logger.error(`Failed to get latest block height: ${(error as Error).message}`)
      return 0
    }
  }

  async getBlockByHeight(height: number): Promise<AnkrTransaction[]> {
    try {
      const url = `${this.baseUrl}/api/v2/block/${height}`
      const { data } = await axios.get<AnkrBlock>(url)

      if (!data?.txs) return []

      return data.txs
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        this.logger.warn(`Block not found at height ${height}`)
      } else {
        this.logger.error(`Failed to get block by height ${height}: ${(error as Error).message}`)
      }
      return []
    }
  }
}
