import { Wallet } from '@/domain/entities/wallet.entity'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

export class WalletRepository extends Repository<Wallet> {
  constructor(@InjectRepository(Wallet) private readonly walletRepository: Repository<Wallet>) {
    super(walletRepository.target, walletRepository.manager, walletRepository.queryRunner)
  }

  createEntity(data: Wallet) {
    return this.save(data)
  }

  createEntities(data: Wallet[]) {
    return this.save(data)
  }

  async getWalletsByChain(chain: Wallet['chain']) {
    const wallets = await this.find({ where: { chain }, select: { address: true } })
    return wallets.map(({ address }) => address)
  }

  async getWalletByAddress(address: Wallet['address']) {
    return this.findOne({ where: { address } })
  }
}
