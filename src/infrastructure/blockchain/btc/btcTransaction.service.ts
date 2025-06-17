import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { TConfiguration } from '../../config/configuration'

const ECPair = ECPairFactory(ecc)

bitcoin.initEccLib(ecc)

type SendBTCParams = {
  toAddress: string
  amount: number
  privateKey: string
}

type UTXO = {
  tx_hash: string
  block_height: number
  tx_input_n: number
  tx_output_n: number
  value: number
  ref_balance: number
  spent: boolean
  confirmations: number
  confirmed: string
  double_spend: boolean
}

@Injectable()
export class BtcTransactionService {
  private readonly logger = new Logger(BtcTransactionService.name)

  private readonly network: bitcoin.Network
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.network = bitcoin.networks.testnet
    this.baseUrl = this.configService.get('btc_api_url')!
    this.apiKey = this.configService.get('blockcypher_api_key')!
  }

  // async onModuleInit() {
  //   this.logger.log('BtcTransactionService initialized')

  //   const address = 'tb1p4dv6yyngmflgmwuh4f0gea79mem8kn7snr5pej9lzu6s8y7wmy5qyjgsr2'
  //   const amount = 0.0001

  //   // Load your private key (WIF)
  //   const privateKeyWIFcompressed = 'cPazJ3XXb4K3kWLRQWo95ttWtzvrJGiSE4SX6km5YYmkfCyZrhg5'

  //   await this.sendBTC({ toAddress: address, amount, privateKey: privateKeyWIFcompressed })
  // }

  async sendBTC({ toAddress, amount, privateKey }: SendBTCParams): Promise<string | null> {
    try {
      const keyPair = ECPair.fromWIF(privateKey, this.network)
      const { publicKey } = keyPair

      // const xOnlyPubkey = publicKey.slice(1, 33) // remove first byte
      // const fromAddress = bitcoin.payments.p2tr({ internalPubkey: Buffer.from(xOnlyPubkey), network: this.network }).address

      const fromAddress = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publicKey), network: this.network }).address

      if (!fromAddress) {
        this.logger.error('Invalid private key')
        return null
      }

      // 1. Get UTXO
      const utxos = await this.getUTXOs(fromAddress)
      if (!utxos.length) {
        this.logger.error(`No UTXOs found for fromAddress: ${fromAddress}`)
        return null
      }

      // 2. Collect transaction
      const psbt = new bitcoin.Psbt({ network: this.network })
      let totalInput = 0

      // Add inputs
      for (const utxo of utxos) {
        const rawTxHex = await this.getRawTx(utxo.tx_hash)
        if (!rawTxHex) {
          this.logger.error(`Failed to get raw tx for ${utxo.tx_hash}`)
          return null
        }
        psbt.addInput({
          hash: utxo.tx_hash,
          index: utxo.tx_output_n,
          nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
        })
        totalInput += +utxo.value
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
      if (change) psbt.addOutput({ address: fromAddress, value: change })

      // 3. Sign
      for (let i = 0; i < utxos.length; i++) {
        try {
          psbt.signInput(i, {
            publicKey: Buffer.from(keyPair.publicKey),
            sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
          })
        } catch (error) {
          this.logger.error(`Error signing input ${i}: ${error.message}`, error)
        }
      }

      psbt.finalizeAllInputs()
      const txHex = psbt.extractTransaction().toHex()

      // 4. Send through BlockCypher
      const txHash = await this.broadcastTransaction(txHex)
      if (!txHash) {
        this.logger.error(`Failed to broadcast transaction for fromAddress: ${fromAddress} amount: ${amount} BTC`)
        return null
      }

      this.logger.log(`Successfully sent ${amount} BTC to ${toAddress} txHash: ${txHash}`)
      return txHash
    } catch (error) {
      this.logger.error(`Error sending to ${toAddress} ${amount} BTC: ${error.message}`, error)
      return null
    }
  }

  private async getUTXOs(address: string): Promise<UTXO[]> {
    try {
      // Implementation of getting UTXOs through API
      const utxoUrl = `${this.baseUrl}/addrs/${address}?unspentOnly=true&token=${this.apiKey}`
      const { data } = await axios.get(utxoUrl)
      const utxos = data.txrefs ?? []
      return utxos
    } catch (error) {
      this.logger.error(`Error getting UTXOs for ${address}: ${error.message}`, error)
      return []
    }
  }

  private async broadcastTransaction(txHex: string): Promise<string | null> {
    // Implementation of sending transaction through API
    const { data } = await axios.post(`${this.baseUrl}/txs/push`, { tx: txHex })
    return data?.hash ?? null
  }

  private async getRawTx(txid: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/txs/${txid}?includeHex=true&token=${this.apiKey}`
      const res = await axios.get(url)
      return res?.data?.hex ?? null
    } catch (error) {
      this.logger.error(`Error getting raw tx for ${txid}: ${error.message}`, error)
      return null
    }
  }
}
