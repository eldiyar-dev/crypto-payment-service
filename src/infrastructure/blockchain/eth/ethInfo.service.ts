import { EvmCoin, EvmNetwork } from '@/common/interfaces'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ethers } from 'ethers'
import { EvmProviderFactory } from './evmProvider.factory'

@Injectable()
export class EthInfoService {
  private readonly logger = new Logger(EthInfoService.name)

  private readonly USDT_ABI = ['function balanceOf(address owner) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)']

  private readonly ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)']

  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly evmProviderFactory: EvmProviderFactory,
  ) {}

  private readonly coinContractAddress = (evmNetwork: EvmNetwork, coin: EvmCoin): string =>
    this.configService.get(`evmNetworks.${evmNetwork}.coinContractAddress.${coin}`, { infer: true })!

  /** Cached, with failover/quorum when several RPC endpoints are configured. */
  private readonly provider = (evmNetwork: EvmNetwork): ethers.Provider => this.evmProviderFactory.get(evmNetwork)

  /**
   * Native balance in wei.
   *
   * Used by reconciliation to detect a wallet still holding funds after a sweep was supposed
   * to complete. Returns null on failure rather than throwing, so one unreachable RPC does not
   * abort a whole reconciliation pass.
   */
  async getNativeBalance(address: string, evmNetwork: EvmNetwork): Promise<bigint | null> {
    try {
      return await this.provider(evmNetwork).getBalance(address)
    } catch (error) {
      this.logger.error(`Failed to get native balance for address ${address}: ${error.message}`)
      return null
    }
  }

  /** ERC20 balance in the token's base units. */
  async getERC20Balance(address: string, contractAddress: string, evmNetwork: EvmNetwork): Promise<bigint | null> {
    try {
      const contract = new ethers.Contract(contractAddress, this.ERC20_BALANCE_ABI, this.provider(evmNetwork))
      return (await contract.balanceOf(address)) as bigint
    } catch (error) {
      this.logger.error(`Failed to get ERC20 balance for address ${address}: ${error.message}`)
      return null
    }
  }

  /**
   * Get the total gas cost, in wei, of a USDT transfer of `amount` base units
   * @param privateKey - The private key of the wallet
   * @param toAddress - The address to send the transaction to
   * @param amount - The amount to send, in the token's base units
   * @param evmNetwork - EVM network
   * @returns The gas cost in wei, or null if estimation failed
   */
  async getUSDTGasCostInWei(privateKey: string, toAddress: string, amount: bigint, evmNetwork: EvmNetwork): Promise<bigint | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)
      const contract = new ethers.Contract(this.coinContractAddress(evmNetwork, 'USDT'), this.USDT_ABI, wallet)

      const gasLimit = await contract.transfer.estimateGas(toAddress, amount)

      const { maxFeePerGas, maxPriorityFeePerGas } = await provider.getFeeData()

      const gasPrice = maxFeePerGas ?? maxPriorityFeePerGas ?? 0n

      return gasPrice * gasLimit
    } catch (error) {
      this.logger.error(`Failed to get gas cost for address ${toAddress} and amount ${amount}: ${error.message}`)
      return null
    }
  }

  /**
   * Get the total gas cost, in wei, of a native transfer of `amount` wei
   * @param privateKey - The private key of the wallet
   * @param toAddress - The address to send ETH to
   * @param amount - The amount to send, in wei
   * @param evmNetwork - The EVM network
   * @returns The gas cost in wei, or null if estimation failed
   */
  async getEthTransferGasCostInWei(privateKey: string, toAddress: string, amount: bigint, evmNetwork: EvmNetwork): Promise<bigint | null> {
    try {
      const provider = this.provider(evmNetwork)
      const wallet = new ethers.Wallet(privateKey, provider)

      // Create a transaction object for a simple ETH transfer
      const gasLimit = await wallet.estimateGas({ to: toAddress, value: amount })

      // Get current gas price data
      const { maxFeePerGas, gasPrice } = await provider.getFeeData()

      // For legacy networks, gasPrice is used; for EIP-1559, maxFeePerGas is used
      const usedGasPrice = maxFeePerGas ?? gasPrice ?? 0n

      return usedGasPrice * gasLimit
    } catch (error) {
      this.logger.error(`Failed to get ETH transfer gas cost for address ${toAddress} and amount ${amount}: ${error.message}`)
      return null
    }
  }
}
