import { USDT_CONTRACT_ADDRESS_NAIL_TESTNET } from '@/common/constants'
import { Currency } from '@/common/enums'
import { Injectable } from '@nestjs/common'
import { BtcTransactionService } from '../btc/btcTransaction.service'
import { EthTransactionService } from '../eth/ethTransaction.service'
import { TronTransactionService } from '../tron/tronTransaction.service'

type TSendFunds = {
  currency: Currency
  toAddress: string
  amount: number
  privateKey: string
}

@Injectable()
export class BlockchainTransactionService {
  constructor(
    private readonly tronTransactionService: TronTransactionService,
    private readonly ethTransactionService: EthTransactionService,
    private readonly btcTransactionService: BtcTransactionService,
  ) {}

  async sendFunds({ currency, toAddress, amount, privateKey }: TSendFunds) {
    switch (currency) {
      case Currency.TRX:
        return this.tronTransactionService.sendTRX({ toAddress, amount, privateKey })

      case Currency.USDT:
        return this.tronTransactionService.sendTRC20Token({ toAddress, amount, privateKey, contractAddress: USDT_CONTRACT_ADDRESS_NAIL_TESTNET })

      // case Currency.ETH:
      //   if (contractAddress) return this.ethTransactionService.sendERC20Token({ toAddress, amount, privateKey, contractAddress })

      //   return this.ethTransactionService.sendETH({ toAddress, amount, privateKey })

      // case Currency.BTC:
      //   return this.btcTransactionService.sendBTC({ fromAddress, toAddress, amount, privateKey })
    }
  }
}
