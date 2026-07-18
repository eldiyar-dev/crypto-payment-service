import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'

type SendTRC20TokenParams = {
  toAddress: string
  /** Amount in the token's base units (USDT: 1e-6 TRC20 units). Exact. */
  amount: bigint
  privateKey: string
  contractAddress: string
}

type SendTRXParams = {
  toAddress: string
  /** Amount in SUN (1 TRX = 1_000_000 SUN). Exact. */
  amount: bigint
  privateKey: string
}

@Injectable()
export class TronTransactionService {
  private readonly logger = new Logger(TronTransactionService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  private tronWebClass() {
    return new TronWeb({ fullHost: this.configService.get('tron_host_url')! })
  }

  /**
   * Send exactly `amount` SUN to an address.
   *
   * This used to subtract a hardcoded 0.5 TRX from every send, which silently shorted every
   * customer TRX withdrawal by 0.5 TRX and drove the smaller split leg negative for small
   * deposits. Fee reserves are the caller's concern — see
   * `SplitWithdrawUseCase.sendTrxForFeeOrActiveAccount`.
   *
   * @param toAddress - The address to send the TRX to
   * @param amount - The amount of TRX to send, in SUN
   * @param privateKey - The private key of the account to send the TRX from
   * @returns The transaction hash of the TRX sent
   */
  async sendTRX({ toAddress, amount, privateKey }: SendTRXParams): Promise<string | null> {
    try {
      const tronWeb = this.tronWebClass()

      // Set the default address for this transaction
      tronWeb.setPrivateKey(privateKey)

      // Already in SUN — exact integer arithmetic, sent as requested.
      const amountInSun = amount
      if (amountInSun <= 0n) {
        this.logger.error(`Refusing to send a non-positive TRX amount to ${toAddress}: ${amountInSun} SUN`)
        return null
      }

      // Create transaction
      const transaction = await tronWeb.transactionBuilder.sendTrx(toAddress, Number(amountInSun))

      // Sign transaction
      const signedTx = await tronWeb.trx.sign(transaction, privateKey)

      // Send transaction
      const receipt = await tronWeb.trx.sendRawTransaction(signedTx)

      if (!receipt.result) {
        this.logger.error(`TRX transfer to ${toAddress} failed receipt:`, receipt)
        return null
      }

      return receipt.txid
    } catch (error) {
      this.logger.error(`TRX transfer to ${toAddress} failed: ${error.message}`)
      return null
    }
  }

  /**
   * Send a TRC20 token to an address
   * @param toAddress - The address to send the TRC20 token to
   * @param amount - The amount of TRC20 token to send, in base units
   * @param privateKey - The private key of the account to send the TRC20 token from
   * @param contractAddress - The address of the TRC20 token contract
   * @returns The transaction hash of the TRC20 token sent
   */
  async sendTRC20Token({ toAddress, amount, privateKey, contractAddress }: SendTRC20TokenParams): Promise<string | null> {
    try {
      const tronWeb = this.tronWebClass()

      // Set the default address for this transaction
      tronWeb.setPrivateKey(privateKey)

      const contract = await tronWeb.contract().at(contractAddress)

      // Already in the token's base units — pass through exactly.
      const amountInWei = amount

      // Create transaction
      const txHash = (await contract.transfer(toAddress, amountInWei.toString()).send({ feeLimit: 100000000, callValue: 0 })) satisfies string

      if (!txHash) {
        this.logger.error(`TRC20 transfer to ${toAddress} failed txHash:`, txHash)
        return null
      }

      return txHash
    } catch (error) {
      this.logger.error(`TRC20 transfer to ${toAddress} failed: ${error.message}`)
      return null
    }
  }
}
