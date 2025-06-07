import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TronWeb } from 'tronweb'

@Injectable()
export class TronEnergyService {
  private readonly tronWeb: TronWeb
  private readonly energyMarketContract = 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4' // Energy Rental Market contract

  constructor(private readonly configService: ConfigService) {
    this.tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': this.configService.get<string>('tron_pro_api_key') },
    })
  }

  /**
   * Арендует 131,000 энергии для указанного адреса
   * @param address Tron адрес, для которого арендуется энергия
   */
  async rentEnergy(address: string): Promise<any> {
    const energyAmount = 131_000
    const days = 1
    // Минимальная сумма TRX для аренды (уточните на https://tronscan.org/#/energy/rent)
    // Здесь мы просто отправим транзакцию на контракт Energy Rental Market
    try {
      const contract = await this.tronWeb.contract().at(this.energyMarketContract)
      // Метод rentEnergy(address,uint256,uint256) - уточните ABI на Tronscan
      // Ниже пример вызова, ABI может отличаться!
      const tx = await contract.rentEnergy(address, energyAmount, days).send({
        feeLimit: 100_000_000,
      })
      return tx
    } catch (error) {
      throw new Error(`Ошибка аренды энергии: ${error.message}`)
    }
  }
}
