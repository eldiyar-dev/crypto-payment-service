import { decodeTrc20Transfer, TRC20_TRANSFER_FROM_SELECTOR, TRC20_TRANSFER_SELECTOR } from './trc20.util'

const ADDRESS_A = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const ADDRESS_B = '1f2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e'

const word = (hex: string) => hex.padStart(64, '0')
const addressWord = (address: string) => word(address)
const amountWord = (amount: bigint) => word(amount.toString(16))

const transferData = (to: string, amount: bigint) => `${TRC20_TRANSFER_SELECTOR}${addressWord(to)}${amountWord(amount)}`

const transferFromData = (from: string, to: string, amount: bigint) => `${TRC20_TRANSFER_FROM_SELECTOR}${addressWord(from)}${addressWord(to)}${amountWord(amount)}`

describe('decodeTrc20Transfer', () => {
  describe('transfer(address,uint256)', () => {
    it('decodes the recipient and amount', () => {
      expect(decodeTrc20Transfer(transferData(ADDRESS_A, 1_500_000n))).toEqual({ toAddressHex: `41${ADDRESS_A}`, amount: 1_500_000n })
    })

    it('decodes a full uint256 amount without loss', () => {
      const huge = 2n ** 200n + 12345n
      expect(decodeTrc20Transfer(transferData(ADDRESS_A, huge))?.amount).toBe(huge)
    })
  })

  // This is the case the old offsets got wrong. It read the recipient from hex 76..116 —
  // misaligned inside the argument word — and then read the *amount* from 72..136, which is
  // the recipient word, not the value. The malformed address failed the allow-list check, so
  // transferFrom-delivered USDT deposits were silently missed.
  describe('transferFrom(address,address,uint256)', () => {
    it('decodes the second address argument as the recipient, not the first', () => {
      const decoded = decodeTrc20Transfer(transferFromData(ADDRESS_A, ADDRESS_B, 42_000_000n))

      expect(decoded?.toAddressHex).toBe(`41${ADDRESS_B}`)
      expect(decoded?.toAddressHex).not.toBe(`41${ADDRESS_A}`)
    })

    it('reads the amount from the third word, not the recipient word', () => {
      const decoded = decodeTrc20Transfer(transferFromData(ADDRESS_A, ADDRESS_B, 42_000_000n))
      expect(decoded?.amount).toBe(42_000_000n)
    })

    it('does not confuse the two selectors', () => {
      const from = decodeTrc20Transfer(transferFromData(ADDRESS_A, ADDRESS_B, 1n))
      const plain = decodeTrc20Transfer(transferData(ADDRESS_B, 1n))
      expect(from).toEqual(plain)
    })
  })

  describe('rejects unusable calldata', () => {
    it('returns null for an unrelated selector', () => {
      expect(decodeTrc20Transfer(`deadbeef${addressWord(ADDRESS_A)}${amountWord(1n)}`)).toBeNull()
    })

    // The old guard was `data.length < 136` — too short for transferFrom, which needs 200 —
    // and it ran *after* the slices had already been taken.
    it('returns null for a truncated transferFrom rather than a garbage address and amount', () => {
      const truncated = transferFromData(ADDRESS_A, ADDRESS_B, 1n).slice(0, 170)
      expect(truncated.length).toBeGreaterThan(136) // would have passed the old guard
      expect(decodeTrc20Transfer(truncated)).toBeNull()
    })

    it('returns null for a truncated transfer', () => {
      expect(decodeTrc20Transfer(transferData(ADDRESS_A, 1n).slice(0, 100))).toBeNull()
    })

    it('returns null when an address word has dirty high bytes', () => {
      const dirty = `${TRC20_TRANSFER_SELECTOR}${'ff'.repeat(12)}${ADDRESS_A}${amountWord(1n)}`
      expect(decodeTrc20Transfer(dirty)).toBeNull()
    })

    it.each(['', 'a9059cbb', undefined as unknown as string])('returns null for %s', (data) => {
      expect(decodeTrc20Transfer(data)).toBeNull()
    })
  })
})
