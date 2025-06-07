import { Global, Module } from '@nestjs/common'
import { BlockchainTransactionService } from '../../blockchain/transaction/transaction.service'
import { BtcBlockhainModule } from '../blockchain/btcBlockhain.module'
import { EthBlockhainModule } from '../blockchain/ethBlockhain.module'
import { TronBlockhainModule } from '../blockchain/tronBlockhain.module'

@Global()
@Module({
  imports: [TronBlockhainModule, EthBlockhainModule, BtcBlockhainModule],
  providers: [BlockchainTransactionService],
  exports: [BlockchainTransactionService],
})
export class BlockchainTransactionModule {}
