import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

@Injectable()
export class BtcInfoService {
  private readonly logger = new Logger(BtcInfoService.name)

  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.baseUrl = this.configService.get('btc_api_url')!
    this.apiKey = this.configService.get('blockcypher_api_key')!
  }

  /**
   * Get the BTC balance for a given address
   * @param address - The Bitcoin address to check
   * @returns The balance in BTC as a number
   */
  async getBTCBalance(address: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/addrs/${address}/balance?token=${this.apiKey}`
      const { data } = await axios.get(url)
      const balance = (data?.balance ?? 0) / 1e8 // BTC
      return balance
    } catch (error) {
      this.logger.error(`Failed to get BTC balance for address ${address}: ${error.message}`)
      return null
    }
  }
}
