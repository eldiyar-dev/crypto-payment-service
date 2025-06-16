import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { TConfiguration } from '../../config/configuration'

const ECPair = ECPairFactory(ecc)

type SendBTCParams = {
  toAddress: string
  amount: number
  privateKey: string
}

@Injectable()
export class BtcTransactionService {
  private readonly logger = new Logger(BtcTransactionService.name)

  private readonly network: bitcoin.Network
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.network = bitcoin.networks.testnet
    this.baseUrl = this.configService.get('btc_rpc_url')!
    this.apiKey = this.configService.get('blockcypher_api_key')!
  }

  private async getUTXOs(address: string) {
    // Реализация получения UTXOs через API
    const response = await axios.get(`${this.baseUrl}/address/${address}/utxo`)
    return response.data
  }

  private async broadcastTransaction(txHex: string) {
    // Реализация отправки транзакции через API
    const response = await axios.post(`${this.baseUrl}/tx/send`, { rawtx: txHex })
    return response.data
  }

  async sendBTC({ toAddress, amount, privateKey }: SendBTCParams): Promise<string | null> {
    try {
      const keyPair = ECPair.fromWIF(privateKey, this.network)
      const { publicKey } = keyPair

      const { address: fromAddress } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(publicKey), network: this.network })
      if (!fromAddress) {
        this.logger.error('Invalid private key')
        return null
      }

      // 1. Получаем UTXO
      const utxoUrl = `${this.baseUrl}/addrs/${fromAddress}?unspentOnly=true&token=${this.apiKey}`
      const utxoResp = await axios.get(utxoUrl)
      const utxos = utxoResp.data.txrefs ?? []

      if (utxos.length === 0) {
        this.logger.error(`No UTXOs found for ${fromAddress}`)
        return null
      }

      // 2. Собираем транзакцию
      const psbt = new bitcoin.Psbt({ network: this.network })
      let totalInput = 0
      utxos.forEach((utxo) => {
        psbt.addInput({
          hash: utxo.tx_hash,
          index: utxo.tx_output_n,
          // You may need to add nonWitnessUtxo: Buffer.from(rawTxHex, 'hex')
        })
        totalInput += utxo.value
      })

      const amountSatoshi = Math.floor(amount * 1e8)
      const fee = 1000 // Можно рассчитать динамически
      const change = totalInput - amountSatoshi - fee
      if (change < 0) {
        this.logger.error(`Insufficient funds for ${toAddress} ${amount} BTC`)
        return null
      }

      psbt.addOutput({ address: toAddress, value: amountSatoshi })
      if (change > 0) psbt.addOutput({ address: fromAddress, value: change })

      // 3. Подписываем
      utxos.forEach((_, idx: number) =>
        psbt.signInput(idx, {
          publicKey: Buffer.from(keyPair.publicKey),
          sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
        }),
      )
      psbt.finalizeAllInputs()
      const txHex = psbt.extractTransaction().toHex()

      // 4. Отправляем через BlockCypher
      const sendResp = await axios.post(`${this.baseUrl}/txs/push?token=${this.apiKey}`, { tx: txHex })
      return sendResp.data?.tx_ref
    } catch (error) {
      this.logger.error(`Error sending to ${toAddress} ${amount} BTC: ${error.message}`, error)
      return null
    }
  }
}
