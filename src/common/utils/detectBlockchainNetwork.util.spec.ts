import { Chain } from '@/common/enums'
import { detectBlockchainNetwork, isEvmNetwork } from './detectBlockchainNetwork.util'

describe('detectBlockchainNetwork', () => {
  it.each([
    ['0x742d35Cc6634C0532925a3b844Bc454e4438f44e', Chain.ETH],
    ['0x742d35cc6634c0532925a3b844bc454e4438f44e', Chain.ETH],
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', Chain.BTC],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', Chain.BTC],
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', Chain.BTC],
    ['TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', Chain.TRON],
  ])('detects %s as %s', (address, expected) => {
    expect(detectBlockchainNetwork(address)).toBe(expected)
  })

  // The old implementation pattern-matched only, so all of these were accepted as valid.
  it.each([
    ['a TRON address using O/I/l, which are not base58', 'TOIlabPrwbZy45sbavfcjinPJC18kjpRT8'],
    ['a TRON address with a corrupted checksum', 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv9'],
    ['a BTC address with a corrupted checksum', '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfnb'],
    ['an EVM address with a bad EIP-55 checksum', '0x742d35Cc6634C0532925a3b844Bc454e4438f44E'],
    ['nonsense', 'invalid'],
    ['an empty string', ''],
  ])('rejects %s', (_label, address) => {
    expect(detectBlockchainNetwork(address)).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(detectBlockchainNetwork('  TJRabPrwbZy45sbavfcjinPJC18kjpRTv8  ')).toBe(Chain.TRON)
  })
})

describe('isEvmNetwork', () => {
  it('classifies chains correctly', () => {
    expect(isEvmNetwork(Chain.ETH)).toBe(true)
    expect(isEvmNetwork(Chain.EVM_FANTOM)).toBe(true)
    expect(isEvmNetwork(Chain.BTC)).toBe(false)
    expect(isEvmNetwork(Chain.TRON)).toBe(false)
  })
})
