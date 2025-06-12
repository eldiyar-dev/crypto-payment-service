/**
 * Generates a unique amount by adding a small "dust" value
 * @param baseAmount - The base amount (e.g., 0.5)
 * @param precision - Number of decimal places (default: 8)
 * @returns A unique number slightly larger than baseAmount
 * @example
 * ```ts
 * const amount = generateUniqueAmount(0.5) // Returns something like 0.50723456
 * const amount2 = generateUniqueAmount(1.0, 4) // Returns something like 1.0034
 * ```
 */
export const generateUniqueAmount = (baseAmount: number, precision = 8): number => {
  // Generate small "dust" based on time and random number
  const dust = (Math.random() + (Date.now() % 1)) * 0.01 // maximum 0.01
  // Add and round to specified precision
  const uniqueAmount = baseAmount + dust
  return Number(uniqueAmount.toFixed(precision))
}
