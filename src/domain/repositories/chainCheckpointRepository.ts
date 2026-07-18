import { Chain } from '@/common/enums'
import { ChainCheckpoint } from '@/domain/entities/chainCheckpoint.entity'
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

@Injectable()
export class ChainCheckpointRepository extends Repository<ChainCheckpoint> {
  constructor(@InjectRepository(ChainCheckpoint) private readonly checkpointRepository: Repository<ChainCheckpoint>) {
    super(checkpointRepository.target, checkpointRepository.manager, checkpointRepository.queryRunner)
  }

  /**
   * @returns The highest fully-scanned block for a chain, or null if the chain has never been
   * scanned — in which case the caller should start from the current tip rather than replaying
   * the whole chain.
   */
  async getLastScannedBlock(chain: Chain): Promise<number | null> {
    const checkpoint = await this.findOne({ where: { chain } })
    if (!checkpoint) return null

    return Number(checkpoint.lastScannedBlock)
  }

  /** Idempotent upsert, so a restart or a concurrent writer cannot duplicate the row. */
  async setLastScannedBlock(chain: Chain, block: number): Promise<void> {
    await this.upsert({ chain, lastScannedBlock: String(block) }, ['chain'])
  }
}
