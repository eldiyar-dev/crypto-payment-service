/**
 * Calculates the main and additional amounts based on a total amount and percentage split
 * @param totalAmount - The total amount to be split
 * @param percentage - The percentage (0-100) to allocate to the additional amount
 * @returns An object containing the calculated main and additional amounts
 * @example
 * // Returns { mainAmount: 80, additionalAmount: 20 }
 * splitAmountByPercentage(100, 20)
 */
export const splitAmountByPercentage = (totalAmount: number, percentage: number): { mainAmount: number; additionalAmount: number } => {
  const additionalAmount = totalAmount * (percentage / 100)
  const mainAmount = totalAmount * ((100 - percentage) / 100)

  return {
    mainAmount,
    additionalAmount,
  }
}
