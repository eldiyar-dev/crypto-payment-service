import { Chain, Currency } from '@/common/enums'
import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TConfiguration } from '../../config/configuration'
import { BtcTransactionService } from '../btc/btcTransaction.service'
import { EthTransactionService } from '../eth/ethTransaction.service'
import { TronTransactionService } from '../tron/tronTransaction.service'

type TSendFunds = {
  currency: Currency
  toAddress: string
  /** Amount in the currency's base units (wei / satoshi / SUN / token base units). Exact. */
  amount: bigint
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

  private evmCoinContractAddress(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!
  }

  /**
   * Token decimals differ per network — USDT is 6 decimals on Ethereum but 18 on BSC — so they
   * are read from config rather than hardcoded.
   */
  private evmCoinDecimals(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinDecimals.${coin}`, { infer: true })!
  }

  sendFunds({ currency, toAddress, amount, privateKey, chain }: TSendFunds) {
    switch (chain) {
      case Chain.BTC:
        return this.btcTransactionService.sendBTC({ toAddress, amount, privateKey })

      case Chain.TRON: {
        if (currency === Currency.TRX) return this.tronTransactionService.sendTRX({ toAddress, amount, privateKey })
        else return this.tronTransactionService.sendTRC20Token({ toAddress, amount, privateKey, contractAddress: this.tronUsdtContractAddress })
      }

      default: {
        if (currency === Currency.ETH) return this.ethTransactionService.sendETH({ privateKey, toAddress, amount, evmNetwork: chain })
        if (currency === Currency.USDT)
          return this.ethTransactionService.sendERC20Token({
            toAddress,
            amount,
            privateKey,
            contractAddress: this.evmCoinContractAddress(chain, 'USDT'),
            decimals: this.evmCoinDecimals(chain, 'USDT'),
            evmNetwork: chain,
            coin: 'USDT',
          })
      }
    }
  }
}
