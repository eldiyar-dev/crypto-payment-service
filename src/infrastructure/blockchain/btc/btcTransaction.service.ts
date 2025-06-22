import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { TConfiguration } from '../../config/configuration'
import { BtcInfoService } from './btcInfo.service'

const ECPair = ECPairFactory(ecc)

bitcoin.initEccLib(ecc)

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

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly btcInfoService: BtcInfoService,
  ) {
    this.network = bitcoin.networks.bitcoin
    this.baseUrl = this.configService.get('btc_api_url')!
  }

  async sendBTC({ toAddress, amount, privateKey }: SendBTCParams): Promise<string | null> {
    try {
      const keyPair = ECPair.fromWIF(privateKey, this.network)
      const { publicKey } = keyPair

      const fromAddress = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publicKey), network: this.network }).address

      if (!fromAddress) {
        this.logger.error('Invalid private key')
        return null
      }

      // 1. Get UTXO from Ankr
      const utxos = await this.btcInfoService.getUTXOs(fromAddress)
      if (!utxos.length) {
        this.logger.error(`No UTXOs found for fromAddress: ${fromAddress}`)
        return null
      }

      // 2. Collect transaction
      const psbt = new bitcoin.Psbt({ network: this.network })
      let totalInput = 0

      // Add inputs
      for (const utxo of utxos) {
        const rawTxHex = await this.btcInfoService.getRawTx(utxo.txid)
        if (!rawTxHex) {
          this.logger.error(`Failed to get raw tx for ${utxo.txid}`)
          return null
        }
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
        })
        totalInput += parseInt(utxo.value, 10)
      }

      const amountSatoshi = Math.floor(amount * 1e8)
      const fee = 1000 // satoshi
      if (totalInput < amountSatoshi + fee) {
        this.logger.error(`Insufficient funds for fromAddress: ${fromAddress} amount: ${amount} BTC`)
        return null
      }

      // Add outputs
      psbt.addOutput({ address: toAddress, value: amountSatoshi })

      // Add change if necessary
      const change = totalInput - amountSatoshi - fee
      if (change > 0) psbt.addOutput({ address: fromAddress, value: change })

      // 3. Sign
      for (let i = 0; i < utxos.length; i++) {
        const signer = {
          publicKey: Buffer.from(keyPair.publicKey),
          sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
        }
        psbt.signInput(i, signer)
      }

      psbt.finalizeAllInputs()
      const txHex = psbt.extractTransaction().toHex()

      // 4. Send through Ankr
      const txHash = await this.broadcastTransaction(txHex)
      if (!txHash) {
        this.logger.error(`Failed to broadcast transaction for fromAddress: ${fromAddress} amount: ${amount} BTC`)
        return null
      }

      this.logger.log(`Successfully sent ${amount} BTC to ${toAddress} txHash: ${txHash}`)
      return txHash
    } catch (error) {
      this.logger.error(`Error sending to ${toAddress} ${amount} BTC: ${(error as Error).message}`, error)
      return null
    }
  }

  private async broadcastTransaction(txHex: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/api/v2/sendtx/`
      const { data } = await axios.post<{ result: string }>(url, { 'hex-tx-data': txHex }, { headers: { 'Content-Type': 'application/json' } })
      return data?.result ?? null
    } catch (error) {
      this.logger.error(`Error broadcasting transaction: ${(error as Error).message}`, error)
      return null
    }
  }
}
