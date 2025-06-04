import { StoreWalletUseCase } from '@/application/usecases/manage-wallets/store-wallet.usecase'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { WalletController } from '@/presentation/controllers/wallet.controller'
import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BtcMonitorService } from '../blockchain/btcMonitor.service'
import { EthMonitorService } from '../blockchain/ethMonitor.service'
import { TronMonitorService } from '../blockchain/tronMonitor.service'

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Wallet])],
  controllers: [WalletController],
  providers: [StoreWalletUseCase, WalletRepository, EthMonitorService, BtcMonitorService, TronMonitorService],
  exports: [WalletRepository],
})
export class WalletModule {}
