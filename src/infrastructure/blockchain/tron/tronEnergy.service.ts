import { TConfiguration } from '@/infrastructure/config/configuration'
import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import { TronWeb } from 'tronweb'

/**
 * Service for buying ENERGY resource on the Tron blockchain using the Tronsave API.
 *
 * This service allows you to estimate the cost, sign, and create an order to buy ENERGY (or BANDWIDTH)
 * for a given Tron address using the Tronsave platform. It is designed for use with the Tron Nile testnet.
 *
 * Usage:
 *   1. Call buyResourceUsingPrivateKey with the required parameters.
 *   2. The service will estimate the cost, sign the transaction with the provided private key,
 *      and create the order on Tronsave.
 *
 * Note: The private key is never stored in the service and must be provided for each transaction.
 */
// Types for API responses
interface EstimateResponse {
  error: boolean
  message: string
  data: {
    unitPrice: number
    durationSec: number
    estimateTrx: number
    availableResource: number
  } | null
}

interface CreateOrderResponse {
  error: boolean
  message: string
  data: { orderId: string } | null
}

/**
 * Parameters for buying resource using a private key.
 *
 * @property buyAmount - Amount of ENERGY to buy
 * @property requestAddress - Tron address that will send the TRX payment
 * @property receiverAddress - Tron address that will receive the ENERGY
 * @property privateKey - Private key of the requestAddress (used to sign the transaction)
 */
type BuyResourceParams = { buyAmount: number; requestAddress: string; receiverAddress: string; privateKey: string }

@Injectable()
export class TronEnergyService {
  private readonly logger = new Logger(TronEnergyService.name)

  private readonly tronWeb: TronWeb
  private readonly TRONSAVE_RECEIVER_ADDRESS: string
  private readonly TRON_FULL_NODE: string
  private readonly TRONSAVE_API_URL: string
  private readonly RESOURCE_TYPE: 'ENERGY' | 'BANDWIDTH'

  /**
   * Initializes the TronEnergyService with testnet (Nile) endpoints and Tronsave receiver address.
   *
   * @param httpService - NestJS HttpService for making HTTP requests
   */
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {
    // it's main TWZEhq5JuUVvGtutNgnRBATbF8BnHGyn4S
    // it's testnet TATT1UzHRikft98bRFqApFTsaSw73ycfoS
    // Tronsave receiver address
    this.TRONSAVE_RECEIVER_ADDRESS = this.configService.get('tronsave_receiver_address')!

    // it's main https://api.tronsave.io
    // it's testnet https://api-dev.tronsave.io
    // Tronsave API
    this.TRONSAVE_API_URL = this.configService.get('tronsave_api_url')!

    // Tron full node
    this.TRON_FULL_NODE = this.configService.get('tron_host_url')!

    // Resource type to buy (ENERGY or BANDWIDTH)
    this.RESOURCE_TYPE = 'ENERGY'

    this.tronWeb = new TronWeb({
      fullNode: this.TRON_FULL_NODE,
      solidityNode: this.TRON_FULL_NODE,
      eventServer: this.TRON_FULL_NODE,
      headers: { 'TRON-PRO-API-KEY': this.configService.get('tron_pro_api_key')! },
    })
  }

  /**
   * Estimates the cost and availability for buying ENERGY (or BANDWIDTH) from Tronsave.
   *
   * @param resourceAmount - Amount of resource to buy
   * @param durationSec - Duration in seconds for which the resource is rented
   * @returns EstimateResponse with pricing and availability info
   * @throws HttpException if the API call fails
   */
  private async getEstimate(resourceAmount: number, durationSec: number): Promise<EstimateResponse> {
    const url = `${this.TRONSAVE_API_URL}/v2/estimate-buy-resource`
    const body = { resourceAmount, unitPrice: 'MEDIUM', resourceType: this.RESOURCE_TYPE, durationSec }

    try {
      const { data } = await firstValueFrom(this.httpService.post<EstimateResponse>(url, body, { headers: { 'content-type': 'application/json' } }))
      return data
    } catch (error) {
      this.logger.error(`Failed to get estimate: ${error.message}`, error)
      return { error: true, message: error.message, data: null }
    }
  }

  /**
   * Builds and signs a TRX transaction to pay for ENERGY using the provided private key.
   *
   * @param estimateTrx - Amount of TRX to send (from estimate)
   * @param requestAddress - Tron address sending the TRX
   * @param privateKey - Private key for signing the transaction
   * @returns Signed transaction object
   * @throws HttpException if signing fails
   */
  private async getSignedTransaction(estimateTrx: number, requestAddress: string, privateKey: string) {
    try {
      const dataSendTrx = await this.tronWeb.transactionBuilder.sendTrx(this.TRONSAVE_RECEIVER_ADDRESS, estimateTrx, requestAddress)
      const signedTx = await this.tronWeb.trx.sign(dataSendTrx, privateKey)
      return signedTx
    } catch (error) {
      this.logger.error(`Failed to sign transaction: ${error.message}`, error)
      return null
    }
  }

  /**
   * Creates an order on Tronsave to buy ENERGY (or BANDWIDTH) with a signed transaction.
   *
   * @param resourceAmount - Amount of resource to buy
   * @param signedTx - Signed TRX transaction
   * @param receiverAddress - Tron address to receive the resource
   * @param unitPrice - Price per unit (from estimate)
   * @param durationSec - Duration in seconds for the resource
   * @returns Order ID
   * @throws HttpException if the API call fails
   */
  private async createOrder(resourceAmount: number, signedTx: any, receiverAddress: string, unitPrice: number, durationSec: number): Promise<string | null> {
    const url = `${this.TRONSAVE_API_URL}/v2/buy-resource`
    const body = { resourceType: this.RESOURCE_TYPE, resourceAmount, unitPrice, allowPartialFill: true, receiver: receiverAddress, durationSec, signedTx }

    try {
      const { data } = await firstValueFrom(this.httpService.post<CreateOrderResponse>(url, body, { headers: { 'content-type': 'application/json' } }))
      if (!data.data?.orderId) {
        this.logger.error('Failed to create order', data)
        return null
      }
      return data.data.orderId
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`, error)
      return null
    }
  }

  /**
   * Main method to buy ENERGY for a given address using a private key.
   *
   * This method:
   *   1. Estimates the cost and checks availability for the requested amount and duration (15 minutes).
   *   2. Signs a TRX transaction with the provided private key to pay Tronsave.
   *   3. Creates an order on Tronsave to allocate ENERGY to the receiver address.
   *
   * @param params - BuyResourceParams object:
   *   - buyAmount: Amount of ENERGY to buy
   *   - requestAddress: Tron address sending the TRX
   *   - receiverAddress: Tron address to receive the ENERGY
   *   - privateKey: Private key for signing the transaction
   * @returns CreateOrderResponse with order ID if successful
   * @throws HttpException if any step fails or not enough resource is available
   */
  async buyResourceUsingPrivateKey({ buyAmount, requestAddress, receiverAddress, privateKey }: BuyResourceParams) {
    const durationSec = 900 // 15 minutes

    // Get estimate for the requested amount and duration
    const estimateData = await this.getEstimate(buyAmount, durationSec)
    if (!estimateData.data || estimateData.error) return null

    const { unitPrice, estimateTrx, availableResource } = estimateData.data
    const isReadyFulfilled = availableResource >= buyAmount
    if (!isReadyFulfilled) {
      this.logger.error('Not enough available resource to fulfill the order', estimateData)
      return null
    }

    // Sign the TRX transaction with the provided private key
    const signedTx = await this.getSignedTransaction(estimateTrx, requestAddress, privateKey)
    if (!signedTx) {
      this.logger.error('Failed to sign transaction', signedTx)
      return null
    }

    // Create the order on Tronsave
    return this.createOrder(buyAmount, signedTx, receiverAddress, unitPrice, durationSec)
  }

  /**
   * Get the remaining energy for an account
   * @param address - The address to get the remaining energy for
   * @returns The remaining energy for the account
   */
  async getAccountResourceEnergy(address: string) {
    const resources = await this.tronWeb.trx.getAccountResources(address)
    const totalEnergy = resources.EnergyLimit || 0
    const usedEnergy = resources.EnergyUsed || 0

    const remainingEnergy = totalEnergy - usedEnergy

    return remainingEnergy
  }
}
