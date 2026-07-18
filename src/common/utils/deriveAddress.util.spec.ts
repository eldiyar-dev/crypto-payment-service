import { Chain } from '@/common/enums'
import { deriveAddressFromPrivateKey, privateKeyMatchesAddress } from './deriveAddress.util'

// Well-known throwaway test vectors. These keys hold no funds and must never be used.
const EVM_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
const EVM_ADDRESS = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23'

const TRON_KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0'

const BTC_WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ'

describe('deriveAddressFromPrivateKey', () => {
  it('derives the EVM address for a key', () => {
    expect(deriveAddressFromPrivateKey(EVM_KEY, Chain.ETH)).toBe(EVM_ADDRESS)
  })

  it('derives the same EVM address on every EVM sibling chain', () => {
    expect(deriveAddressFromPrivateKey(EVM_KEY, Chain.EVM_POLYGON)).toBe(EVM_ADDRESS)
  })

  it('derives a TRON address for a key', () => {
    const derived = deriveAddressFromPrivateKey(TRON_KEY, Chain.TRON)
    expect(derived).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)
  })

  it('derives a bech32 BTC address from a WIF', () => {
    expect(deriveAddressFromPrivateKey(BTC_WIF, Chain.BTC)).toMatch(/^bc1/)
  })

  it('returns null for unusable key material rather than throwing', () => {
    expect(deriveAddressFromPrivateKey('not-a-key', Chain.ETH)).toBeNull()
    expect(deriveAddressFromPrivateKey('not-a-key', Chain.TRON)).toBeNull()
    expect(deriveAddressFromPrivateKey('not-a-key', Chain.BTC)).toBeNull()
    expect(deriveAddressFromPrivateKey(EVM_KEY, Chain.BTC)).toBeNull()
  })
})

describe('privateKeyMatchesAddress', () => {
  // The failure this prevents: registering an address the service cannot sweep. Deposits get
  // detected, every withdrawal fails, and the funds are stranded with no way to move them.
  it('accepts a matching pair', () => {
    expect(privateKeyMatchesAddress(EVM_KEY, EVM_ADDRESS, Chain.ETH)).toBe(true)
  })

  it('accepts an EVM address in any casing', () => {
    expect(privateKeyMatchesAddress(EVM_KEY, EVM_ADDRESS.toLowerCase(), Chain.ETH)).toBe(true)
  })

  it('rejects a key that does not control the address', () => {
    expect(privateKeyMatchesAddress(EVM_KEY, '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', Chain.ETH)).toBe(false)
  })

  it('rejects a BTC address the sweep path could not spend', () => {
    // BtcTransactionService signs p2wpkh, so a legacy address is unsweepable even if the key
    // is otherwise correct.
    expect(privateKeyMatchesAddress(BTC_WIF, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', Chain.BTC)).toBe(false)
  })

  it('accepts the BTC address actually derived from the WIF', () => {
    const derived = deriveAddressFromPrivateKey(BTC_WIF, Chain.BTC)!
    expect(privateKeyMatchesAddress(BTC_WIF, derived, Chain.BTC)).toBe(true)
  })

  it('rejects cross-chain mismatches', () => {
    expect(privateKeyMatchesAddress(TRON_KEY, EVM_ADDRESS, Chain.ETH)).toBe(false)
    expect(privateKeyMatchesAddress(EVM_KEY, EVM_ADDRESS, Chain.TRON)).toBe(false)
  })
})
