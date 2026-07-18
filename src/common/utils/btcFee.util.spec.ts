import { estimateP2wpkhVsize } from './btcFee.util'

describe('estimateP2wpkhVsize', () => {
  it('sizes a simple 1-in 2-out sweep', () => {
    // 11 overhead + 68 input + 2 * 31 outputs
    expect(estimateP2wpkhVsize(1, 2)).toBe(141)
  })

  it('grows with each additional input', () => {
    expect(estimateP2wpkhVsize(2, 2) - estimateP2wpkhVsize(1, 2)).toBe(68)
  })

  it('grows with each additional output', () => {
    expect(estimateP2wpkhVsize(1, 3) - estimateP2wpkhVsize(1, 2)).toBe(31)
  })

  // The defect this replaces: a flat 1000-satoshi fee regardless of size. At a realistic
  // 10 sat/vB even a single-input sweep needs more than that, and a wallet with many small
  // UTXOs needs far more — so those transactions paid below the relay minimum and were
  // rejected or stuck in the mempool with no RBF/CPFP path to rescue them.
  it('shows why the old flat 1000-satoshi fee was unrelayable', () => {
    const FLAT_FEE = 1000
    const rate = 10 // sat/vB

    expect(estimateP2wpkhVsize(1, 2) * rate).toBeGreaterThan(FLAT_FEE)
    expect(estimateP2wpkhVsize(20, 2) * rate).toBeGreaterThan(FLAT_FEE * 10)
  })

  it('is monotonic in both dimensions', () => {
    for (let inputs = 1; inputs < 10; inputs++) {
      expect(estimateP2wpkhVsize(inputs + 1, 2)).toBeGreaterThan(estimateP2wpkhVsize(inputs, 2))
      expect(estimateP2wpkhVsize(inputs, 3)).toBeGreaterThan(estimateP2wpkhVsize(inputs, 2))
    }
  })
})
