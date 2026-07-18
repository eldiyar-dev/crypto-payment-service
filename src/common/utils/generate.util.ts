/**
 * Adds a small random dust amount so that two otherwise-identical fee transfers are
 * distinguishable on-chain.
 *
 * Works in base units: the previous float version computed its dust as
 * `(Math.random() + (Date.now() % 1)) * 0.01`, where `Date.now() % 1` is always 0 because
 * `Date.now()` returns an integer — so the time term contributed nothing and only the random
 * term mattered.
 *
 * @param baseAmount - The base amount in base units
 * @param maxDust - Maximum dust to add, in base units (inclusive)
 * @returns A value in `[baseAmount, baseAmount + maxDust]`
 * @example
 * ```ts
 * // 0.5 TRX plus up to 0.01 TRX of dust, in SUN
 * generateUniqueAmount(500_000n, 10_000n)
 * ```
 */
export const generateUniqueAmount = (baseAmount: bigint, maxDust: bigint): bigint => {
  if (maxDust <= 0n) return baseAmount

  const dust = BigInt(Math.floor(Math.random() * (Number(maxDust) + 1)))
  return baseAmount + dust
}
