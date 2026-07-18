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

  /**
   * Yields a chain's addresses in batches, ordered by primary key.
   *
   * The boot-time seed used to load every address for a chain into one array — at ~24M rows
   * (3M ETH wallets duplicated across 8 EVM chains) that is a single enormous allocation
   * before the monitor can start. Keyset pagination on `id` keeps memory flat and avoids
   * OFFSET's growing cost.
   */
  async *iterateAddressesByChain(chain: Wallet['chain'], batchSize = 10_000): AsyncGenerator<string[]> {
    let lastId = 0

    for (;;) {
      const wallets = await this.createQueryBuilder('wallet')
        .select(['wallet.id', 'wallet.address'])
        .where('wallet.chain = :chain', { chain })
        .andWhere('wallet.id > :lastId', { lastId })
        .orderBy('wallet.id', 'ASC')
        .limit(batchSize)
        .getMany()

      if (!wallets.length) return

      yield wallets.map(({ address }) => address)
      lastId = wallets[wallets.length - 1].id!
    }
  }

  async getWalletByAddress(address: Wallet['address']) {
    return this.findOne({ where: { address } })
  }
}
