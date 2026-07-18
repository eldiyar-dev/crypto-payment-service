import { BTC_DECIMALS, ETH_DECIMALS, formatBaseUnits, parseBaseUnits, TRX_DECIMALS } from './money.util'

describe('formatBaseUnits', () => {
  it.each([
    [1000000n, 6, '1'],
    [1500000n, 6, '1.5'],
    [1n, 6, '0.000001'],
    [0n, 6, '0'],
    [123n, 8, '0.00000123'],
    [100000000n, 8, '1'],
    [1000000000000000000n, 18, '1'],
    [1n, 18, '0.000000000000000001'],
    [-1500000n, 6, '-1.5'],
    [1234n, 0, '1234'],
  ])('formats %s with %s decimals as %s', (base, decimals, expected) => {
    expect(formatBaseUnits(base, decimals)).toBe(expected)
  })

  // The exact case the float pipeline could not represent: a wei-precision amount whose
  // low-order digits are lost the moment it becomes a double.
  it('preserves every wei of an 18-decimal amount, where a float round-trip does not', () => {
    const wei = 1234567890123456789n

    expect(formatBaseUnits(wei, ETH_DECIMALS)).toBe('1.234567890123456789')
    expect(parseBaseUnits(formatBaseUnits(wei, ETH_DECIMALS), ETH_DECIMALS)).toBe(wei)

    // What the old pipeline did: Number(formatEther(value)) and back. A double cannot hold
    // 19 significant digits, so the low-order wei are silently lost.
    const viaFloat = BigInt(Math.trunc(Number(formatBaseUnits(wei, ETH_DECIMALS)) * 1e18))
    expect(viaFloat).not.toBe(wei)
  })
})

describe('parseBaseUnits', () => {
  it.each([
    ['1', 6, 1000000n],
    ['1.5', 6, 1500000n],
    ['0.000001', 6, 1n],
    ['0', 6, 0n],
    ['0.001', 18, 1000000000000000n],
    ['0.00005', 8, 5000n],
    ['-1.5', 6, -1500000n],
  ])('parses %s with %s decimals as %s', (value, decimals, expected) => {
    expect(parseBaseUnits(value, decimals)).toBe(expected)
  })

  it('rejects amounts finer than the currency can represent rather than truncating', () => {
    expect(() => parseBaseUnits('0.0000001', 6)).toThrow(/more than 6 decimal places/)
  })

  it.each(['', 'abc', '1.2.3', '1e18', '0x10', ' ', '1,5'])('rejects malformed input: %s', (value) => {
    expect(() => parseBaseUnits(value, 6)).toThrow()
  })

  it('round-trips through format for every supported currency scale', () => {
    for (const [value, decimals] of [
      ['0.001', ETH_DECIMALS],
      ['1.234567890123456789', ETH_DECIMALS],
      ['0.00005', BTC_DECIMALS],
      ['21000000', BTC_DECIMALS],
      ['1', TRX_DECIMALS],
      ['0.000001', TRX_DECIMALS],
    ] as const) {
      expect(formatBaseUnits(parseBaseUnits(value, decimals), decimals)).toBe(value)
    }
  })
})
