import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'

type SendTRC20TokenParams = {
  toAddress: string
  amount: number
  privateKey: string
  contractAddress: string
}

type SendTRXParams = {
  toAddress: string
  amount: number
  privateKey: string
}

@Injectable()
export class TronTransactionService {
  private readonly tronWeb: TronWeb
  private readonly logger = new Logger(TronTransactionService.name)

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    this.tronWeb = new TronWeb({
      fullHost: 'https://nile.trongrid.io',
      // headers: { 'TRON-PRO-API-KEY': configService.get('tron_pro_api_key') },
    })
  }

  /**
   * Send TRX to an address
   * @param toAddress - The address to send the TRX to
   * @param amount - The amount of TRX to send
   * @param privateKey - The private key of the account to send the TRX from
   * @returns The transaction hash of the TRX sent
   */
  async sendTRX({ toAddress, amount, privateKey }: SendTRXParams): Promise<string | null> {
    try {
      // Set the default address for this transaction
      this.tronWeb.setPrivateKey(privateKey)

      // Convert amount to SUN (1 TRX = 1,000,000 SUN)
      const amountInSun = this.tronWeb.toBigNumber(amount).multipliedBy(1000000)

      // Create transaction
      const transaction = await this.tronWeb.transactionBuilder.sendTrx(toAddress, amountInSun.toNumber())

      // Sign transaction
      const signedTx = await this.tronWeb.trx.sign(transaction, privateKey)

      // Send transaction
      const receipt = await this.tronWeb.trx.sendRawTransaction(signedTx)

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
   * @param amount - The amount of TRC20 token to send
   * @param privateKey - The private key of the account to send the TRC20 token from
   * @param contractAddress - The address of the TRC20 token contract
   * @returns The transaction hash of the TRC20 token sent
   */
  async sendTRC20Token({ toAddress, amount, privateKey, contractAddress }: SendTRC20TokenParams): Promise<string | null> {
    try {
      // Set the default address for this transaction
      this.tronWeb.setPrivateKey(privateKey)

      const contract = await this.tronWeb.contract().at(contractAddress)

      // Convert amount to correct format (considering token decimals)
      const amountInWei = this.tronWeb.toBigNumber(amount).multipliedBy(10 ** 6)

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
