import { StoreWalletUseCase } from '@/application/usecases/manageWallets/store-wallet.usecase'
import { Wallet } from '@/domain/entities/wallet.entity'
import { WalletRepository } from '@/domain/repositories/walletRepository'
import { WalletController } from '@/presentation/controllers/wallet.controller'
import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BtcMonitorService } from '../blockchain/btc/btcMonitor.service'
import { EthMonitorService } from '../blockchain/eth/ethMonitor.service'
import { TronMonitorService } from '../blockchain/tron/tronMonitor.service'

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Wallet])],
  controllers: [WalletController],
  providers: [StoreWalletUseCase, WalletRepository, EthMonitorService, BtcMonitorService, TronMonitorService],
  exports: [WalletRepository],
})
export class WalletModule {}
