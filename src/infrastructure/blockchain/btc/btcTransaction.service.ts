import { BTC_DECIMALS, formatBaseUnits, selectUtxos } from '@/common/utils'
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

      // Already in satoshi — exact.
      const payable = outputs.filter((output) => output.amount > 0n)
      const totalOutput = payable.reduce((sum, output) => sum + output.amount, 0n)

      // 2. Choose inputs. Spending every UTXO produced an oversized transaction that the old
      // flat 1000-satoshi fee then underpaid, and cost one raw-tx fetch per UTXO.
      const feeRate = await this.resolveFeeRate()
      const selection = selectUtxos(utxos, totalOutput, feeRate, payable.length)

      // Fail rather than substitute. "Sending max possible" returned a transaction hash that
      // the caller reported as a completed withdrawal, for an amount nobody requested.
      if (!selection) {
        const available = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n)
        this.logger.error(
          `Insufficient funds for fromAddress: ${fromAddress}: have ${formatBaseUnits(available, BTC_DECIMALS)} BTC, need ${formatBaseUnits(totalOutput, BTC_DECIMALS)} BTC plus fee`,
        )
        return null
      }

      const { selected, fee, change } = selection
      this.logger.log(`Selected ${selected.length}/${utxos.length} UTXO(s), fee ${fee} sat at ${feeRate.toFixed(2)} sat/vB`)

      const psbt = new bitcoin.Psbt({ network: this.network })

      // Raw transactions are fetched only for the inputs actually used.
      for (const utxo of selected) {
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
      }

      for (const output of payable) {
        psbt.addOutput({ address: output.toAddress, value: Number(output.amount) })
      }

      if (change > 0n) psbt.addOutput({ address: fromAddress, value: Number(change) })

      // 3. Sign
      for (let i = 0; i < selected.length; i++) {
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
   * Current fee rate, clamped so that a bad or missing estimate can produce neither an
   * unrelayable transaction nor a fee that drains the wallet.
   */
  private async resolveFeeRate(): Promise<number> {
    const reported = await this.btcInfoService.getFeeRateSatPerVByte()
    if (reported === null) this.logger.warn(`Fee estimate unavailable; falling back to ${this.FALLBACK_FEE_RATE} sat/vB`)

    return Math.min(Math.max(reported ?? this.FALLBACK_FEE_RATE, this.MIN_FEE_RATE), this.MAX_FEE_RATE)
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
