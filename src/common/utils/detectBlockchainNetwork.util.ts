import { Chain, EVM_CHAINS } from '@/common/enums'
import { EvmNetwork } from '../interfaces'
import { isValidChainAddress } from './validateAddress.util'

/**
 * Detects the blockchain network type based on a cryptocurrency address.
 *
 * @param address - The cryptocurrency address to analyze
 * @returns The detected blockchain network (Chain enum) or null if address is invalid or network cannot be determined
 *
 * @example
 * // Ethereum address
 * detectBlockchainNetwork('0x742d35Cc6634C0532925a3b844Bc454e4438f44e') // returns Chain.ETH
 *
 * // Bitcoin address
 * detectBlockchainNetwork('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') // returns Chain.BTC
 *
 * // Tron address
 * detectBlockchainNetwork('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8') // returns Chain.TRON
 *
 * // Invalid address
 * detectBlockchainNetwork('invalid') // returns null
 */
export const detectBlockchainNetwork = (address: string): Chain | null => {
  if (!address || typeof address !== 'string') return null

  const addr = address.trim()

  // Decode-and-verify rather than pattern-match. The previous regexes checked shape only:
  // no EIP-55 checksum for EVM, no base58check for BTC or TRON, and the TRON pattern
  // ^T[A-Za-z1-9]{33}$ admitted O, I and l, which are not in the base58 alphabet at all.
  if (isValidChainAddress(addr, Chain.ETH)) return Chain.ETH
  if (isValidChainAddress(addr, Chain.BTC)) return Chain.BTC
  if (isValidChainAddress(addr, Chain.TRON)) return Chain.TRON

  return null
}

/**
 * Checks if the provided chain is an EVM-compatible network.
 *
 * @param chain - The blockchain network to check (Chain enum)
 * @returns True if the chain is an EVM-compatible network, false otherwise
 *
 * @example
 * isEvmNetwork(Chain.ETH) // true
 * isEvmNetwork(Chain.BTC) // false
 */
export const isEvmNetwork = (chain: Chain): chain is EvmNetwork => {
  return EVM_CHAINS.includes(chain)
}
