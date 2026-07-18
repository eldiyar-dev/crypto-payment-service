export type RetryOptions<T> = {
  /** Total attempts, including the first. */
  retries?: number
  /** Delay before the second attempt; doubles each time, capped by maxDelayMs. */
  baseDelayMs?: number
  maxDelayMs?: number
  /**
   * Whether a *returned* value should be retried. Defaults to retrying only null/undefined.
   *
   * The previous implementation retried any falsy result, so a legitimate `0`, `false` or
   * empty string was treated as a failure.
   */
  shouldRetryResult?: (result: T | null) => boolean
  onError?: (err: Error, attempt: number) => void
}

const defaultShouldRetryResult = <T>(result: T | null): boolean => result === null || result === undefined

/**
 * Executes an operation with bounded retries and exponential backoff.
 *
 * Fixes three problems with the previous version:
 * - It slept **only in the `catch` branch**, so an operation that *returned* null without
 *   throwing retried immediately — three tight iterations with no delay at all, hammering the
 *   RPC it was supposed to be backing off from.
 * - It treated any falsy result as failure, including valid `0` / `false` / `''`.
 * - It slept once more after the final attempt before returning null, delaying the caller for
 *   no benefit.
 *
 * @param operation - The async operation to execute
 * @param options - Retry tuning; see {@link RetryOptions}
 * @returns The operation result, or null if every attempt failed
 * @example
 * ```ts
 * const block = await withRetry(() => provider.getBlock(n), { retries: 3 })
 * ```
 */
export const withRetry = async <T>(operation: () => Promise<T | null>, options: RetryOptions<T> = {}): Promise<T | null> => {
  const { retries = 3, baseDelayMs = 1000, maxDelayMs = 30_000, shouldRetryResult = defaultShouldRetryResult, onError } = options

  let lastResult: T | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await operation()
      if (!shouldRetryResult(result)) return result

      lastResult = result
    } catch (err) {
      onError?.(err as Error, attempt)
    }

    // No sleep after the final attempt — the caller is about to be handed the failure anyway.
    if (attempt < retries) {
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
      // Full jitter, so concurrent retries against a struggling endpoint do not synchronise.
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * backoff)))
    }
  }

  return lastResult
}
