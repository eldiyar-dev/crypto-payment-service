/**
 * Approximate virtual size, in vbytes, of a p2wpkh transaction.
 *
 * Standard segwit component sizes: ~11 vbytes of transaction overhead, ~68 vbytes per p2wpkh
 * input (witness data is discounted), ~31 vbytes per output.
 *
 * Fee = vsize x feeRate. The previous flat 1000-satoshi fee ignored size entirely, so any
 * multi-input sweep paid below the relay minimum and the transaction was rejected or stuck in
 * the mempool with no RBF/CPFP path to rescue it.
 */
export const P2WPKH_TX_OVERHEAD_VBYTES = 11
export const P2WPKH_INPUT_VBYTES = 68
export const P2WPKH_OUTPUT_VBYTES = 31

export const estimateP2wpkhVsize = (inputCount: number, outputCount: number): number =>
  P2WPKH_TX_OVERHEAD_VBYTES + inputCount * P2WPKH_INPUT_VBYTES + outputCount * P2WPKH_OUTPUT_VBYTES

/** Below this, a change output costs more to spend later than it is worth. */
export const DUST_THRESHOLD_SATOSHI = 546n

export type CoinSelection<T> = {
  selected: T[]
  fee: bigint
  /** Change to return to the sender, already net of fee. Zero when it would be dust. */
  change: bigint
}

/**
 * Selects enough UTXOs to cover `target` plus the fee they themselves cost to spend.
 *
 * The sweep previously added **every** UTXO as an input and fetched the full raw transaction
 * for each one — an N+1 of HTTP calls, and an oversized transaction that the flat 1000-satoshi
 * fee then underpaid. Selecting largest-first keeps the input count low, which is what
 * actually drives both the fee and the number of raw-tx lookups.
 *
 * The fee depends on the input count, which depends on the selection, so the two are resolved
 * together: each additional input raises the target it must itself cover.
 *
 * @param utxos - Available UTXOs, each carrying a satoshi `value` string
 * @param target - Total to pay to destinations, in satoshi
 * @param feeRateSatPerVByte - Current network rate
 * @param destinationOutputCount - Number of destination outputs (excluding change)
 * @returns The chosen inputs with the resulting fee and change, or null if the UTXOs cannot
 * cover the target plus its fee — in which case the caller must fail rather than send less.
 */
export const selectUtxos = <T extends { value: string }>(utxos: T[], target: bigint, feeRateSatPerVByte: number, destinationOutputCount: number): CoinSelection<T> | null => {
  // Largest first: fewest inputs for a given target, so the smallest fee and the fewest
  // raw-transaction fetches.
  const candidates = [...utxos].sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : BigInt(b.value) < BigInt(a.value) ? -1 : 0))

  const selected: T[] = []
  let accumulated = 0n

  for (const utxo of candidates) {
    selected.push(utxo)
    accumulated += BigInt(utxo.value)

    const feeWithChange = BigInt(Math.ceil(estimateP2wpkhVsize(selected.length, destinationOutputCount + 1) * feeRateSatPerVByte))
    const feeWithoutChange = BigInt(Math.ceil(estimateP2wpkhVsize(selected.length, destinationOutputCount) * feeRateSatPerVByte))

    // Prefer returning change, but if what is left over would be dust, fold it into the fee
    // rather than creating an output that costs more to spend than it holds.
    if (accumulated >= target + feeWithChange) {
      const change = accumulated - target - feeWithChange

      if (change >= DUST_THRESHOLD_SATOSHI) return { selected, fee: feeWithChange, change }
      return { selected, fee: accumulated - target, change: 0n }
    }

    if (accumulated >= target + feeWithoutChange) return { selected, fee: accumulated - target, change: 0n }
  }

  return null
}
