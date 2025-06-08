import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import { TConfiguration } from '../../config/configuration'

type SendBTCParams = {
  fromAddress: string
  toAddress: string
  amount: number
  privateKey: string
}

@Injectable()
export class BtcTransactionService {
  private readonly network: bitcoin.Network
  private readonly apiUrl: string

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.network = bitcoin.networks.bitcoin
    this.apiUrl = this.configService.get('btc_rpc_url')!
  }

  async sendBTC({ fromAddress, toAddress, amount, privateKey }: SendBTCParams) {
    // try {
    //   // Получаем UTXOs для адреса
    //   const utxos = await this.getUTXOs(fromAddress)
    //   // Создаем транзакцию
    //   const txb = new bitcoin.TransactionBuilder(this.network)
    //   let totalInput = 0
    //   utxos.forEach((utxo) => {
    //     txb.addInput(utxo.txid, utxo.vout)
    //     totalInput += utxo.value
    //   })
    //   // Конвертируем сумму в сатоши
    //   const amountInSatoshi = Math.floor(amount * 100000000)
    //   // Добавляем выход
    //   txb.addOutput(toAddress, amountInSatoshi)
    //   // Добавляем сдачу
    //   const fee = 1000 // Примерная комиссия
    //   const change = totalInput - amountInSatoshi - fee
    //   if (change > 0) {
    //     txb.addOutput(fromAddress, change)
    //   }
    //   // Подписываем транзакцию
    //   const keyPair = bitcoin.ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), { network: this.network })
    //   utxos.forEach((utxo, index) => {
    //     txb.sign(index, keyPair)
    //   })
    //   // Создаем финальную транзакцию
    //   const tx = txb.build()
    //   // Отправляем транзакцию
    //   const result = await this.broadcastTransaction(tx.toHex())
    //   return result
    // } catch (error) {
    //   throw new Error(`BTC transfer failed: ${error.message}`)
    // }
  }

  private async getUTXOs(address: string) {
    // Реализация получения UTXOs через API
    const response = await axios.get(`${this.apiUrl}/address/${address}/utxo`)
    return response.data
  }

  private async broadcastTransaction(txHex: string) {
    // Реализация отправки транзакции через API
    const response = await axios.post(`${this.apiUrl}/tx/send`, { rawtx: txHex })
    return response.data
  }
}
