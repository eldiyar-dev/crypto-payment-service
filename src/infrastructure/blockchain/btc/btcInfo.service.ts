import { AnkrAddress, AnkrBlock, AnkrStatus, AnkrTransaction, UTXO } from '@/common/interfaces'
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

  async getBlockByHeightAllPages(height: number): Promise<AnkrTransaction[]> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = `${this.baseUrl}/api/v2/block/${height}`
        const { data } = await axios.get<AnkrBlock>(url, { timeout: 10000 })
        if (!data?.txs) return []

        let allTxs = [...data.txs]
        const totalPages = data.totalPages || 1

        if (totalPages <= 1) return allTxs

        const requests = Array.from({ length: totalPages - 1 }, (_, i) => axios.get<AnkrBlock>(`${url}?page=${i + 2}`))

        const responses = await Promise.all(requests)
        for (const { data } of responses) {
          if (!data?.txs?.length) continue

          allTxs = allTxs.concat(data.txs)
        }

        return allTxs
      } catch (error) {
        const axiosError = error as AxiosError
        this.logger.error(`Attempt ${attempt}: Failed to get all block pages for height ${height}: ${axiosError.message}, code: ${axiosError.code}, url: ${axiosError.config?.url}`)
        if (attempt === 3) return []
        await new Promise((res) => setTimeout(res, 1000 * attempt))
      }
    }
    return []
  }

  async getUTXOs(address: string): Promise<UTXO[]> {
    try {
      const utxoUrl = `${this.baseUrl}/api/v2/utxo/${address}`
      const { data } = await axios.get<UTXO[]>(utxoUrl)
      return data ?? []
    } catch (error) {
      this.logger.error(`Error getting UTXOs for ${address}: ${(error as Error).message}`, error)
      return []
    }
  }

  async getRawTx(txid: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/api/v2/tx/${txid}`
      const { data } = await axios.get<{ hex: string }>(url)
      return data?.hex ?? null
    } catch (error) {
      this.logger.error(`Error getting raw tx for ${txid}: ${(error as Error).message}`, error)
      return null
    }
  }

  async getTxByHash(txHash: string): Promise<AnkrTransaction | null> {
    try {
      const url = `${this.baseUrl}/api/v2/tx/${txHash}`
      const { data } = await axios.get<AnkrTransaction>(url)
      return data ?? null
    } catch (error) {
      this.logger.error(`Error getting tx by hash ${txHash}: ${(error as Error).message}`, error)
      return null
    }
  }
}
