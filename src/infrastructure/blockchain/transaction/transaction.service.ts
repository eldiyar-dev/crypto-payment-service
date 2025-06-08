import { Chain, Currency } from '@/common/enums'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TConfiguration } from '../../config/configuration'
import { BtcTransactionService } from '../btc/btcTransaction.service'
import { EthTransactionService } from '../eth/ethTransaction.service'
import { TronTransactionService } from '../tron/tronTransaction.service'

type TSendFunds = {
  currency: Currency
  toAddress: string
  amount: number
  privateKey: string
  chain: Chain
}

@Injectable()
export class BlockchainTransactionService {
  constructor(
    private readonly tronTransactionService: TronTransactionService,
    private readonly ethTransactionService: EthTransactionService,
    private readonly btcTransactionService: BtcTransactionService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  private get tronUsdtContractAddress() {
    return this.configService.get('tron_usdt_contract_address')!
  }

  private get ethUsdtContractAddress() {
    return this.configService.get('eth_usdt_contract_address')!
  }

  async sendFunds({ currency, toAddress, amount, privateKey, chain }: TSendFunds) {
    switch (currency) {
      case Currency.TRX:
        return this.tronTransactionService.sendTRX({ toAddress, amount, privateKey })

      case Currency.USDT:
        if (chain === Chain.TRON) return this.tronTransactionService.sendTRC20Token({ toAddress, amount, privateKey, contractAddress: this.tronUsdtContractAddress })
        else return this.ethTransactionService.sendERC20Token({ toAddress, amount, privateKey, contractAddress: this.ethUsdtContractAddress, decimals: 6 })

      case Currency.ETH:
        return this.ethTransactionService.sendETH({ privateKey, toAddress, amount })

      // case Currency.BTC:
      //   return this.btcTransactionService.sendBTC({ fromAddress, toAddress, amount, privateKey })
    }
  }
}
