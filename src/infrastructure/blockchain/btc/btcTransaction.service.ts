import { BTC_DECIMALS, formatBaseUnits } from '@/common/utils'
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
  /** Amount in satoshi. Exact. */
  amount: bigint
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
      let totalInput = 0n

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
        totalInput += BigInt(utxo.value)
      }

      // Already in satoshi — exact.
      const amountSatoshi = amount
      const fee = 1000n // satoshi

      if (totalInput < fee) {
        this.logger.error(`Insufficient funds for fee for fromAddress: ${fromAddress}`)
        return null
      }

      // Fail rather than substitute. "Sending max possible" returned a transaction hash that
      // the caller reported as a completed withdrawal, for an amount nobody requested.
      if (totalInput < amountSatoshi + fee) {
        this.logger.error(
          `Insufficient funds for fromAddress: ${fromAddress}: have ${formatBaseUnits(totalInput, BTC_DECIMALS)} BTC, need ${formatBaseUnits(amountSatoshi + fee, BTC_DECIMALS)} BTC (amount + fee)`,
        )
        return null
      }

      const sendAmount = amountSatoshi

      psbt.addOutput({ address: toAddress, value: Number(sendAmount) })

      const change = totalInput - sendAmount - fee
      if (change > 0n) psbt.addOutput({ address: fromAddress, value: Number(change) })

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
        this.logger.error(`Failed to broadcast transaction for fromAddress: ${fromAddress} amount: ${formatBaseUnits(amount, BTC_DECIMALS)} BTC`)
        return null
      }

      this.logger.log(`Successfully sent ${formatBaseUnits(amount, BTC_DECIMALS)} BTC to ${toAddress} txHash: ${txHash}`)
      return txHash
    } catch (error) {
      this.logger.error(`Error sending to ${toAddress} ${formatBaseUnits(amount, BTC_DECIMALS)} BTC: ${(error as Error).message}`, error)
      return null
    }
  }

  private async broadcastTransaction(txHex: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/api/v2/sendtx/${txHex}`
      const { data } = await axios.get<{ result: string }>(url)
      return data?.result ?? null
    } catch (error) {
      this.logger.error(`Error broadcasting transaction: ${(error as Error).message}`, error)
      return null
    }
  }
}
