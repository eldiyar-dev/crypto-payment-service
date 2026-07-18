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

import { DUST_THRESHOLD_SATOSHI, selectUtxos } from './btcFee.util'

const utxo = (value: bigint, txid = 'tx') => ({ txid, value: value.toString() })

describe('selectUtxos', () => {
  it('uses one large UTXO instead of every available UTXO', () => {
    const utxos = [utxo(1_000n), utxo(1_000_000n), utxo(2_000n)]

    const selection = selectUtxos(utxos, 500_000n, 10, 1)

    expect(selection?.selected).toHaveLength(1)
    expect(selection?.selected[0].value).toBe('1000000')
  })

  it('accumulates more inputs when one is not enough', () => {
    const utxos = [utxo(300_000n), utxo(300_000n), utxo(300_000n)]

    const selection = selectUtxos(utxos, 700_000n, 10, 1)

    expect(selection!.selected.length).toBeGreaterThanOrEqual(3)
  })

  // The conservation property: inputs must exactly equal outputs + change + fee.
  it('balances inputs against outputs, change and fee', () => {
    const utxos = [utxo(1_000_000n), utxo(500_000n)]
    const target = 900_000n

    const { selected, fee, change } = selectUtxos(utxos, target, 12, 2)!
    const totalIn = selected.reduce((sum, u) => sum + BigInt(u.value), 0n)

    expect(totalIn).toBe(target + fee + change)
  })

  it('never returns a dust change output', () => {
    // Tuned so the leftover after fee is below the dust threshold.
    const utxos = [utxo(100_000n)]
    const feeRate = 10
    const selection = selectUtxos(utxos, 100_000n - BigInt(Math.ceil(estimateP2wpkhVsize(1, 1) * feeRate)) - 100n, feeRate, 1)!

    expect(selection.change === 0n || selection.change >= DUST_THRESHOLD_SATOSHI).toBe(true)
  })

  // Failing here is what makes "send max possible" unnecessary: the caller aborts instead.
  it('returns null when the UTXOs cannot cover the target plus its fee', () => {
    expect(selectUtxos([utxo(1_000n)], 100_000n, 10, 1)).toBeNull()
  })

  it('returns null when the balance covers the target but not the fee', () => {
    expect(selectUtxos([utxo(10_000n)], 10_000n, 50, 1)).toBeNull()
  })

  it('returns null for an empty UTXO set', () => {
    expect(selectUtxos([], 1n, 10, 1)).toBeNull()
  })

  it('scales the fee with the number of selected inputs', () => {
    const many = Array.from({ length: 20 }, (_, i) => utxo(60_000n, `tx${i}`))
    const one = [utxo(1_200_000n)]

    const manyFee = selectUtxos(many, 1_000_000n, 10, 1)!.fee
    const oneFee = selectUtxos(one, 1_000_000n, 10, 1)!.fee

    expect(manyFee).toBeGreaterThan(oneFee)
  })
})
