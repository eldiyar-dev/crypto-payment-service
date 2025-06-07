import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'
import { ContractParamter } from 'tronweb/lib/esm/types/Contract'
import { SignedTransaction } from 'tronweb/lib/esm/types/Transaction'
import { BroadcastReturn } from 'tronweb/lib/esm/types/Trx'

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

  constructor(configService: ConfigService<TConfiguration>) {
    this.tronWeb = new TronWeb({
      fullHost: 'https://api.shasta.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': configService.get('tron_pro_api_key') },
    })
  }

  async sendTRX({ toAddress, amount, privateKey }: SendTRXParams): Promise<BroadcastReturn<SignedTransaction<ContractParamter>>> {
    try {
      // Convert amount to SUN (1 TRX = 1,000,000 SUN)
      const amountInSun = this.tronWeb.toBigNumber(amount).multipliedBy(1000000)

      // Create transaction
      const transaction = await this.tronWeb.transactionBuilder.sendTrx(toAddress, amountInSun.toNumber())

      // Sign transaction
      const signedTx = await this.tronWeb.trx.sign(transaction, privateKey)

      // Send transaction
      const result = await this.tronWeb.trx.sendRawTransaction(signedTx)

      return result
    } catch (error) {
      throw new Error(`TRX transfer failed: ${error.message}`)
    }
  }

  async sendTRC20Token({ toAddress, amount, privateKey, contractAddress }: SendTRC20TokenParams): Promise<BroadcastReturn<SignedTransaction<ContractParamter>>> {
    try {
      const contract = await this.tronWeb.contract().at(contractAddress)

      // Convert amount to correct format (considering token decimals)
      const amountInWei = this.tronWeb.toBigNumber(amount).multipliedBy(10 ** 6)

      // Create transaction
      const transaction = await contract.transfer(toAddress, amountInWei.toString()).send({ feeLimit: 100000000, callValue: 0 })

      // Sign and send
      const signedTx = await this.tronWeb.trx.sign(transaction, privateKey)
      const result = await this.tronWeb.trx.sendRawTransaction(signedTx)

      return result
    } catch (error) {
      throw new Error(`TRC20 transfer failed: ${error.message}`)
    }
  }
}
