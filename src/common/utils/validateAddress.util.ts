import { Chain, EVM_CHAINS } from '@/common/enums'
import * as bitcoin from 'bitcoinjs-lib'
import { ethers } from 'ethers'
import { TronWeb } from 'tronweb'

/**
 * Validates a Bitcoin mainnet address by decoding it to an output script.
 *
 * This covers base58check (`1…`, `3…`) and bech32/bech32m (`bc1…`) including the checksum,
 * unlike a pattern match. Note that base58 addresses are case-sensitive: lowercasing one
 * produces an address that fails here, which is exactly the intent.
 */
const isValidBtcAddress = (address: string): boolean => {
  try {
    bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
    return true
  } catch {
    return false
  }
}

/**
 * Validates that an address is well-formed for a specific chain, checksum included.
 *
 * Used on both ends of the money path: on wallet registration, and on destination addresses
 * returned by the client API before they are used as transaction outputs. A malformed
 * destination means an irrecoverable send.
 *
 * @param address - The address to validate
 * @param chain - The chain the address is claimed to belong to
 * @returns True when the address is valid for that chain
 */
export const isValidChainAddress = (address: string, chain: Chain): boolean => {
  if (!address || typeof address !== 'string') return false

  // EVM_CHAINS directly rather than isEvmNetwork(), to keep this module free of a cycle with
  // detectBlockchainNetwork.util, which now depends on this one.
  if (EVM_CHAINS.includes(chain)) return ethers.isAddress(address)
  if (chain === Chain.BTC) return isValidBtcAddress(address)
  if (chain === Chain.TRON) return TronWeb.isAddress(address)

  return false
}
