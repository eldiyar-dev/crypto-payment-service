import { ETH_USDT_CONTRACT_ADDRESS_SEPOLIA, NAIL_TESTNET_USDT_CONTRACT_ADDRESS } from '@/common/constants/contractAddress.constant'
import { Chain, Currency } from '@/common/enums'
import { Injectable } from '@nestjs/common'
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
  ) {}

  async sendFunds({ currency, toAddress, amount, privateKey, chain }: TSendFunds) {
    switch (currency) {
      case Currency.TRX:
        return this.tronTransactionService.sendTRX({ toAddress, amount, privateKey })

      case Currency.USDT:
        if (chain === Chain.TRON) return this.tronTransactionService.sendTRC20Token({ toAddress, amount, privateKey, contractAddress: NAIL_TESTNET_USDT_CONTRACT_ADDRESS })
        else return this.ethTransactionService.sendERC20Token({ toAddress, amount, privateKey, contractAddress: ETH_USDT_CONTRACT_ADDRESS_SEPOLIA })

      case Currency.ETH:
        return this.ethTransactionService.sendETH({ toAddress, amount, privateKey })

      // case Currency.BTC:
      //   return this.btcTransactionService.sendBTC({ fromAddress, toAddress, amount, privateKey })
    }
  }
}
