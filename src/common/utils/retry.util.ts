/**
 * Executes an operation with retry logic
 * @param operation - The async operation to execute
 * @param retries - Number of retry attempts (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 1000)
 * @param onError - Optional callback for error handling
 * @returns The operation result or null if all retries fail
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchData(),
 *   3,
 *   1000,
 *   (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`)
 * );
 * ```
 */
export const withRetry = async <T>(operation: () => Promise<T | null>, retries = 3, delayMs = 1000, onError?: (err: Error, attempt: number) => void): Promise<T | null> => {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await operation()
      if (result) return result
    } catch (err) {
      onError?.(err as Error, i + 1)
      await new Promise((res) => setTimeout(res, delayMs))
    }
  }
  return null
}
