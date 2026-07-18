import { Chain, Currency } from '@/common/enums'
import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { ETH_DECIMALS, formatBaseUnits, parseBaseUnits, withRetry } from '@/common/utils'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ContractEventPayload, ethers } from 'ethers'
import { TConfiguration } from '../../config/configuration'

type DepositCallback = (data: {
  address: string
  amount: bigint
  decimals: number
  currency: Currency
  txHash: string
  /** Log index for token transfers; 0 for native transfers, which credit one address per tx. */
  outputIndex: number
  blockHash?: string | null
  blockNumber?: bigint | null
  evmNetwork: EvmNetwork
}) => void

@Injectable()
export class EthMonitorService {
  private readonly logger = new Logger(EthMonitorService.name)

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  /** Dust thresholds, held as decimal strings and converted to base units per network. */
  private readonly minEthDeposit = '0.001' // 0.001 ETH
  private readonly minUsdtDeposit = '0.5' // 0.5 USDT

  private depositCallback: DepositCallback

  async getAddresses(): Promise<string[]> {
    const addresses = await this.redisService.getAddresses(Chain.ETH)
    return addresses.map((address) => address.toLowerCase())
  }

  private usdtContract: ethers.Contract

  // ERC20 ABI for Transfer event
  private readonly ERC20_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)']

  onDeposit(callback: DepositCallback) {
    this.depositCallback = callback
  }

  private getProviderWssUrl(evmNetwork: EvmNetwork) {
    return this.configService.get(`evmNetworks.${evmNetwork}.wssUrl`, { infer: true })!
  }

  private getCoinContractAddress(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!
  }

  /** USDT is 6 decimals on Ethereum but 18 on BSC, so decimals are per-network. */
  private getCoinDecimals(evmNetwork: EvmNetwork, coin: EvmCoin) {
    return this.configService.get(`evmNetworks.${evmNetwork}.coinDecimals.${coin}`, { infer: true })!
  }

  async start(evmNetwork: EvmNetwork) {
    try {
      const provider = new ethers.WebSocketProvider(this.getProviderWssUrl(evmNetwork))

      const reconnect = async () => {
        await provider.removeAllListeners()
        await provider.destroy()
        await this.start(evmNetwork)
      }

      void provider.on('error', async (err) => {
        this.logger.error(`WebSocketProvider error: ${err.message}`, err)
        await reconnect()
      })
      provider.websocket.onerror = async (err) => {
        this.logger.error(`WebSocket error: ${err.message}`, err)
        await reconnect()
      }

      await this.listenEthTransfers(provider, evmNetwork)

      this.usdtContract = new ethers.Contract(this.getCoinContractAddress(evmNetwork, 'USDT'), this.ERC20_ABI, provider)
      await this.listenUsdtTransfers(this.usdtContract, evmNetwork)
    } catch (err) {
      this.logger.error(`Error starting ETH monitor network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`, err)
    }
  }

  private async listenEthTransfers(provider: ethers.WebSocketProvider, evmNetwork: EvmNetwork) {
    return provider.on('block', async (blockNumber: number) => {
      try {
        this.logger.log(`Checking block ${blockNumber} network: ${evmNetwork}`)
        await this.checkBlockForDeposits(provider, blockNumber, evmNetwork)
      } catch (err) {
        this.logger.error(`Error processing block network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`, err)
      }
    })
  }

  private async checkBlockForDeposits(provider: ethers.WebSocketProvider, blockNumber: number, evmNetwork: EvmNetwork) {
    const block = await this.getBlockWithRetry(provider, blockNumber)
    if (!block) {
      this.logger.error(`Block ${blockNumber} not found network: ${evmNetwork}`)
      return
    }

    const addresses = await this.getAddresses()

    for (const tx of block.prefetchedTransactions) {
      if (await this.redisService.isFeeTransactionHash(tx.hash)) {
        this.logger.log(`Ignoring fee transaction: ${tx.hash}`)
        continue
      }

      if (!tx?.to) {
        this.logger.log(`Transaction ${tx.hash} has no to address network: ${evmNetwork}`)
        continue
      }
      const to = tx.to.toLowerCase()
      if (!addresses.includes(to)) continue

      // tx.value is already exact wei — never narrow it through a float.
      const amountWei = tx.value
      if (amountWei < parseBaseUnits(this.minEthDeposit, ETH_DECIMALS)) continue

      this.logger.log(`Deposit detected: ${formatBaseUnits(amountWei, ETH_DECIMALS)} ETH from ${tx.from} to ${to} txHash: ${tx.hash} network: ${evmNetwork}`)
      this.depositCallback({
        address: to,
        amount: amountWei,
        decimals: ETH_DECIMALS,
        currency: Currency.ETH,
        txHash: tx.hash,
        outputIndex: 0,
        blockHash: block.hash,
        blockNumber: BigInt(blockNumber),
        evmNetwork,
      })
    }
  }

  private async getBlockWithRetry(provider: ethers.WebSocketProvider, blockNumber: number): Promise<ethers.Block | null> {
    return withRetry(() => provider.getBlock(blockNumber, true))
  }

  private async listenUsdtTransfers(usdtContract: ethers.Contract, evmNetwork: EvmNetwork) {
    return usdtContract.on('Transfer', async (from: string, to: string, value: ethers.BigNumberish, event: ContractEventPayload) => {
      try {
        const toLower = to.toLowerCase()
        if (!(await this.getAddresses()).includes(toLower)) return

        const decimals = this.getCoinDecimals(evmNetwork, 'USDT')
        const amountBase = ethers.toBigInt(value)
        if (amountBase < parseBaseUnits(this.minUsdtDeposit, decimals)) return

        const txHash = event.log.transactionHash

        this.logger.log(`Deposit detected: ${formatBaseUnits(amountBase, decimals)} USDT from ${from} to ${toLower} txHash: ${txHash} network: ${evmNetwork}`)
        this.depositCallback({
          address: toLower,
          amount: amountBase,
          decimals,
          currency: Currency.USDT,
          txHash,
          // Distinguishes multiple USDT transfers to the same address within one transaction.
          outputIndex: event.log.index,
          blockHash: event.log.blockHash,
          blockNumber: BigInt(event.log.blockNumber),
          evmNetwork,
        })
      } catch (err) {
        this.logger.error(`Error processing USDT transfer network: ${evmNetwork} ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }
}
