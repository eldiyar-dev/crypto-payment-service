/**
 * Basis points in 100%. `pie` is honoured to two decimal places (1 bp); anything finer is
 * rounded to the nearest basis point so the split stays exact integer arithmetic.
 */
const BPS_TOTAL = 10_000n

/**
 * Splits a base-unit amount between the main and additional destinations.
 *
 * Both legs are derived from a single division so that they always sum to exactly the input:
 * the additional leg is truncated down, and the **main leg absorbs the rounding remainder**.
 * Computing each leg independently (`total * pct` and `total * (100 - pct)`) leaves the residue
 * unallocated, so the two legs no longer add up to the deposit.
 *
 * @param totalAmount - The total amount to split, in base units
 * @param percentage - The percentage (0-100) allocated to the additional destination
 * @returns The two legs, in base units, guaranteed to sum to `totalAmount`
 * @throws {Error} If the percentage is not a finite number within [0, 100] — a bad ratio must
 * fail loudly rather than produce a NaN or negative leg.
 * @example
 * // Returns { mainAmount: 80n, additionalAmount: 20n }
 * splitAmountByPercentage(100n, 20)
 * @example
 * // 1 wei cannot be split; the main leg keeps it
 * // Returns { mainAmount: 1n, additionalAmount: 0n }
 * splitAmountByPercentage(1n, 20)
 */
export const splitAmountByPercentage = (totalAmount: bigint, percentage: number): { mainAmount: bigint; additionalAmount: bigint } => {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error(`Split percentage must be a finite number in [0, 100], got ${String(percentage)}`)
  }
  if (totalAmount < 0n) throw new Error(`Cannot split a negative amount: ${totalAmount}`)

  const bps = BigInt(Math.round(percentage * 100))

  const additionalAmount = (totalAmount * bps) / BPS_TOTAL
  const mainAmount = totalAmount - additionalAmount

  return { mainAmount, additionalAmount }
}
