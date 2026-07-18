import { StoreWalletUseCase } from '@/application/usecases/manageWallets/store-wallet.usecase'
import { AESCipherService } from '@/common/services/aes.service'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { WalletController } from '@/presentation/controllers/wallet.controller'
import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BtcMonitorService } from '../blockchain/btc'
import { BtcBlockhainModule } from './blockchain'

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Wallet]), forwardRef(() => BtcBlockhainModule)],
  controllers: [WalletController],
  providers: [StoreWalletUseCase, WalletRepository, BtcMonitorService, AESCipherService],
  exports: [WalletRepository],
})
export class WalletModule {}
