import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'

@Injectable()
export class BtcInfoService {
  private readonly logger = new Logger(BtcInfoService.name)
  private readonly baseUrl = 'https://api.blockcypher.com'

  /**
   * Get the BTC balance for a given address
   * @param address - The Bitcoin address to check
   * @returns The balance in BTC as a number
   */
  async getBTCBalance(address: string): Promise<number> {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/btc/main/addrs/${address}/balance`)
      const balance = response.data.final_balance / 100000000 // Convert satoshis to BTC
      return balance
    } catch (error) {
      this.logger.error(`Failed to get BTC balance for address ${address}: ${error.message}`)
      throw error
    }
  }
}
