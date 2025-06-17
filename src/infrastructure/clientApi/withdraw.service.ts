import { Chain, Currency } from '@/common/enums'
import type { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type TWithdrawWalletsResponseData = {
  mainAddress: string
  mainPrivateKey: string
  additionalAddress: string
  pie: number
}

@Injectable()
export class WithdrawService {
  private readonly logger = new Logger(WithdrawService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  async getWithdrawWallets(chain: Chain, currency: Currency, address: string): Promise<TWithdrawWalletsResponseData | null> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      if (chain === Chain.TRON) {
        return {
          additionalAddress: 'TWX27NPThSd4MWfQ6bpX6NfuHK6tdiB8dJ',
          mainAddress: 'TTuZtfBV6YYuWmemQky5YnpqgQYV7NACac',
          mainPrivateKey: 'C7A1C54A449C5EFBEB72D41C4022C345183443BB56843A3C93DD9EC1C0D145DE',
          pie: 80,
        }
      }
      if (chain === Chain.ETH) {
        return {
          additionalAddress: '0x1dce693BC35304e21FaaE84FD5fc619e9ED369E2'.toLowerCase(),
          mainAddress: '0x8913e0632fd0AA017467d0e33Ca43226E2E81400'.toLowerCase(),
          mainPrivateKey: '0x0298f4f8d0cabd2eeab5080e9988578e6ce96dda7671c1e05ee41928975efb49',
          pie: 80,
        }
      }
      if (chain === Chain.BTC) {
        return {
          additionalAddress: 'tb1plefl6l8nw2ecvnytpe3wwfnhwgcsry8l6ppszgyf4j2j9p770qzq2eskyf',
          mainAddress: 'tb1pza4m7ct6jeummd8qejgg3kxfgtm7pft7y32ymuc3vrrssdqzhdjqq72sun',
          mainPrivateKey: 'cPazJ3XXb4K3kWLRQWo95ttWtzvrJGiSE4SX6km5YYmkfCyZrhg5',
          pie: 80,
        }
      }

      // const baseUrl = this.configService.get('client_api_url')
      // const response = await axios.get<TWithdrawWalletsResponseData>(`${baseUrl}/api/withdraw_wallets/`, {
      //   params: { currency, address },
      // })
      // return response.data

      return null
    } catch (error) {
      this.logger.error(error)
      return null
    }
  }
}
