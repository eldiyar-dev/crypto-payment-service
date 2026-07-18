import { Chain } from '@/common/enums'
import { isValidChainAddress } from './validateAddress.util'

const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
const TRON = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const BTC_LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const BTC_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'
const BTC_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

describe('isValidChainAddress', () => {
  describe('EVM', () => {
    it('accepts checksummed and all-lowercase addresses', () => {
      expect(isValidChainAddress(EVM, Chain.ETH)).toBe(true)
      expect(isValidChainAddress(EVM.toLowerCase(), Chain.ETH)).toBe(true)
    })

    it('rejects a bad EIP-55 checksum', () => {
      expect(isValidChainAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44E', Chain.ETH)).toBe(false)
    })

    it('applies to every EVM sibling chain', () => {
      expect(isValidChainAddress(EVM, Chain.EVM_POLYGON)).toBe(true)
      expect(isValidChainAddress(EVM, Chain.EVM_BSC)).toBe(true)
    })

    it('rejects wrong-length and non-hex values', () => {
      expect(isValidChainAddress('0x742d35Cc', Chain.ETH)).toBe(false)
      expect(isValidChainAddress('not-an-address', Chain.ETH)).toBe(false)
    })
  })

  describe('TRON', () => {
    it('accepts a valid base58check address', () => {
      expect(isValidChainAddress(TRON, Chain.TRON)).toBe(true)
    })

    // The previous regex ^T[A-Za-z1-9]{33}$ admitted O/I/l, which are not in the base58 alphabet.
    it('rejects characters outside the base58 alphabet', () => {
      expect(isValidChainAddress('TOIlabPrwbZy45sbavfcjinPJC18kjpRT8', Chain.TRON)).toBe(false)
    })

    it('rejects a corrupted checksum', () => {
      expect(isValidChainAddress('TJRabPrwbZy45sbavfcjinPJC18kjpRTv9', Chain.TRON)).toBe(false)
    })
  })

  describe('BTC', () => {
    it.each([BTC_LEGACY, BTC_P2SH, BTC_BECH32])('accepts %s', (address) => {
      expect(isValidChainAddress(address, Chain.BTC)).toBe(true)
    })

    // Base58 addresses are case-sensitive; lowercasing one yields an unusable address. This is
    // the invariant that makes the address-normalisation bug in StoreWalletUseCase detectable.
    it('rejects a lowercased base58 address', () => {
      expect(isValidChainAddress(BTC_LEGACY.toLowerCase(), Chain.BTC)).toBe(false)
      expect(isValidChainAddress(BTC_P2SH.toLowerCase(), Chain.BTC)).toBe(false)
    })

    it('rejects a corrupted checksum', () => {
      expect(isValidChainAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfnb', Chain.BTC)).toBe(false)
    })
  })

  describe('cross-chain confusion', () => {
    it('rejects an address presented as the wrong chain', () => {
      expect(isValidChainAddress(EVM, Chain.BTC)).toBe(false)
      expect(isValidChainAddress(EVM, Chain.TRON)).toBe(false)
      expect(isValidChainAddress(TRON, Chain.ETH)).toBe(false)
      expect(isValidChainAddress(BTC_LEGACY, Chain.TRON)).toBe(false)
    })
  })

  it('rejects empty and non-string input', () => {
    expect(isValidChainAddress('', Chain.ETH)).toBe(false)
    expect(isValidChainAddress(undefined as unknown as string, Chain.ETH)).toBe(false)
  })
})
