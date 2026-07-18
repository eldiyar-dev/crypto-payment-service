import { BTC_DECIMALS, estimateP2wpkhVsize, formatBaseUnits } from '@/common/utils'
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

type SendBTCToManyParams = {
  /** One output per destination. All are funded by a single transaction. */
  outputs: Array<{ toAddress: string; amount: bigint }>
  privateKey: string
}

@Injectable()
export class BtcTransactionService {
  private readonly logger = new Logger(BtcTransactionService.name)

  private readonly network: bitcoin.Network
  private readonly baseUrl: string

  /** Relay minimum. Below this a transaction is simply not propagated. */
  private readonly MIN_FEE_RATE = 1
  /** Guards against a wildly wrong estimate draining the wallet in fees. */
  private readonly MAX_FEE_RATE = 500
  private readonly FALLBACK_FEE_RATE = 10

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly btcInfoService: BtcInfoService,
  ) {
    this.network = bitcoin.networks.bitcoin
    this.baseUrl = this.configService.get('btc_api_url')!
  }

  async sendBTC({ toAddress, amount, privateKey }: SendBTCParams): Promise<string | null> {
    return this.sendBTCToMany({ outputs: [{ toAddress, amount }], privateKey })
  }

  /**
   * Pays several destinations from one transaction.
   *
   * This is what makes a two-leg split safe on Bitcoin. Sending the legs as two sequential
   * transactions is worse than a no-op on failure: the first spends *every* UTXO, and the
   * second immediately re-queries getUTXOs, which either returns nothing (change still
   * unconfirmed, so leg 2 fails and the split is half-done) or returns the same now-spent
   * UTXOs, producing a conflicting double-spend. One transaction with both outputs either
   * lands whole or not at all.
   */
  async sendBTCToMany({ outputs, privateKey }: SendBTCToManyParams): Promise<string | null> {
    try {
      if (!outputs.length) {
        this.logger.error('No outputs supplied')
        return null
      }
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
      const totalOutput = outputs.reduce((sum, output) => sum + output.amount, 0n)

      // Sized from the actual transaction and the current network rate. A flat 1000 sat
      // regardless of size meant that any multi-input sweep fell below the relay minimum, so
      // the transaction was rejected or stuck in the mempool indefinitely — and there is no
      // RBF/CPFP path to rescue it.
      const outputCount = outputs.filter((output) => output.amount > 0n).length + 1 // +1 for change
      const fee = await this.estimateFee(utxos.length, outputCount)

      if (totalInput < fee) {
        this.logger.error(`Insufficient funds for fee for fromAddress: ${fromAddress}`)
        return null
      }

      // Fail rather than substitute. "Sending max possible" returned a transaction hash that
      // the caller reported as a completed withdrawal, for an amount nobody requested.
      if (totalInput < totalOutput + fee) {
        this.logger.error(
          `Insufficient funds for fromAddress: ${fromAddress}: have ${formatBaseUnits(totalInput, BTC_DECIMALS)} BTC, need ${formatBaseUnits(totalOutput + fee, BTC_DECIMALS)} BTC (amount + fee)`,
        )
        return null
      }

      for (const output of outputs) {
        if (output.amount <= 0n) continue
        psbt.addOutput({ address: output.toAddress, value: Number(output.amount) })
      }

      const change = totalInput - totalOutput - fee
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
        this.logger.error(`Failed to broadcast transaction for fromAddress: ${fromAddress} amount: ${formatBaseUnits(totalOutput, BTC_DECIMALS)} BTC`)
        return null
      }

      this.logger.log(`Successfully sent ${formatBaseUnits(totalOutput, BTC_DECIMALS)} BTC across ${outputs.length} output(s) txHash: ${txHash}`)
      return txHash
    } catch (error) {
      this.logger.error(`Error sending BTC from ${outputs.length} output(s): ${(error as Error).message}`)
      return null
    }
  }

  /**
   * Estimates the fee for a p2wpkh transaction of the given shape.
   *
   * vsize is approximated from the standard segwit component sizes: ~11 vbytes of overhead,
   * ~68 vbytes per p2wpkh input, ~31 vbytes per output. The rate is clamped so that a bad or
   * missing estimate cannot produce either an unrelayable transaction or a catastrophic
   * overpay.
   */
  private async estimateFee(inputCount: number, outputCount: number): Promise<bigint> {
    const vsize = estimateP2wpkhVsize(inputCount, outputCount)

    const reported = await this.btcInfoService.getFeeRateSatPerVByte()
    if (reported === null) this.logger.warn(`Fee estimate unavailable; falling back to ${this.FALLBACK_FEE_RATE} sat/vB`)

    const rate = Math.min(Math.max(reported ?? this.FALLBACK_FEE_RATE, this.MIN_FEE_RATE), this.MAX_FEE_RATE)
    const fee = BigInt(Math.ceil(vsize * rate))

    this.logger.log(`Estimated fee: ${fee} sat (${vsize} vbytes at ${rate.toFixed(2)} sat/vB, ${inputCount} in / ${outputCount} out)`)
    return fee
  }

  /**
   * Broadcasts a signed transaction via Blockbook's POST endpoint.
   *
   * The hex used to be interpolated into the URL path (`GET /api/v2/sendtx/${txHex}`). A
   * multi-input sweep easily exceeds typical 8KB URL limits, so those transactions failed —
   * and the signed transaction was written into every proxy and access log along the path.
   * POST keeps it in the request body.
   */
  private async broadcastTransaction(txHex: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/api/v2/sendtx/`
      const { data } = await axios.post<{ result: string }>(url, txHex, {
        headers: { 'content-type': 'text/plain' },
        timeout: 30_000,
      })
      return data?.result ?? null
    } catch (error) {
      // Log the message only — the full axios error serialises the request body, which is the
      // signed transaction.
      this.logger.error(`Error broadcasting transaction: ${(error as Error).message}`)
      return null
    }
  }
}
