import { Chain } from '@/common/enums'
import * as bitcoin from 'bitcoinjs-lib'
import ECPairFactory from 'ecpair'
import { ethers } from 'ethers'
import * as ecc from 'tiny-secp256k1'
import { TronWeb } from 'tronweb'
import { isEvmNetwork } from './detectBlockchainNetwork.util'

const ECPair = ECPairFactory(ecc)

/**
 * Derives the address that a private key actually controls, for a given chain.
 *
 * Used to verify that a submitted (address, privateKey) pair agrees before the address is added
 * to the monitored set. Without this check the service will happily watch an address whose key
 * it does not hold: deposits are detected, the sweep fails, and the funds are stranded.
 *
 * The BTC derivation is p2wpkh (bech32) because that is what BtcTransactionService signs with.
 * A legacy `1...` or p2sh `3...` address therefore fails this check — correctly, since the
 * sweep path could not spend it either.
 *
 * @returns The derived address, or null if the key is unusable for that chain
 */
export const deriveAddressFromPrivateKey = (privateKey: string, chain: Chain): string | null => {
  try {
    if (isEvmNetwork(chain)) return new ethers.Wallet(privateKey).address

    if (chain === Chain.TRON) return TronWeb.address.fromPrivateKey(privateKey) || null

    if (chain === Chain.BTC) {
      const keyPair = ECPair.fromWIF(privateKey, bitcoin.networks.bitcoin)
      return bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network: bitcoin.networks.bitcoin }).address ?? null
    }

    return null
  } catch {
    return null
  }
}

/**
 * Checks that a private key controls the address it is registered against.
 *
 * Comparison is case-insensitive for EVM (addresses may arrive checksummed or not) and exact
 * for BTC and TRON, whose base58/bech32 encodings are case-sensitive.
 */
export const privateKeyMatchesAddress = (privateKey: string, address: string, chain: Chain): boolean => {
  const derived = deriveAddressFromPrivateKey(privateKey, chain)
  if (!derived) return false

  return isEvmNetwork(chain) ? derived.toLowerCase() === address.toLowerCase() : derived === address
}
