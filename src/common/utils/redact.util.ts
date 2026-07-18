/**
 * Keys whose values must never reach a log sink. Matched case-insensitively as a substring, so
 * `privateKey`, `fromAddressPrivateKey`, `mainSecret` and `x-api-key` are all covered.
 */
export const SENSITIVE_KEY = /(privatekey|private_key|secret|mnemonic|seed|passphrase|password|apikey|api_key|authorization|cookie|wif)/i

export const REDACTED = '[REDACTED]'

const MAX_DEPTH = 6

/**
 * Recursively replaces the values of sensitive-looking keys.
 *
 * Axios errors are the main reason this exists: `logger.error(msg, error)` serialises
 * `error.config` (headers, params) and `error.response.data`, and the `withdraw_wallets`
 * response body carries the destination hot-wallet key.
 *
 * @param value - Arbitrary log payload
 * @returns A structurally similar value with sensitive fields replaced
 */
export const redactSensitive = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[TRUNCATED]'
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (value instanceof Error) {
    // Keep errors readable without dragging along request/response payloads.
    return { name: value.name, message: value.message, stack: value.stack }
  }

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1, seen))

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(item, depth + 1, seen)
  }
  return output
}
