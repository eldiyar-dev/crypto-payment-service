import { Chain } from '@/common/enums'

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

  // Ethereum and EVM-compatible networks (0x...)
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return Chain.ETH
  }

  // Bitcoin networks
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)) {
    return Chain.BTC
  }
  if (/^bc1[a-z0-9]{39,59}$/.test(addr)) {
    return Chain.BTC
  }
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)) {
    return Chain.BTC
  }

  // Tron
  if (/^T[A-Za-z1-9]{33}$/.test(addr)) {
    return Chain.TRON
  }

  return null
}
