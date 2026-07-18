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
