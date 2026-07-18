/**
 * The result of attempting an outbound transfer.
 *
 * Every `send*` implementation used to return `string | null`, so the caller could not
 * distinguish "the source wallet has no gas" — which the top-up-and-retry path exists to fix —
 * from "the destination address is malformed", which retrying can never fix. Both got the same
 * treatment: fund the wallet, retry once, fail. That wasted a gas transfer on every terminal
 * failure and hid the real cause.
 */
export type SendOutcome = { ok: true; txHash: string } | { ok: false; retryable: boolean; message: string }

export const sendSucceeded = (txHash: string): SendOutcome => ({ ok: true, txHash })

export const sendFailed = (message: string, retryable = false): SendOutcome => ({ ok: false, retryable, message })

/**
 * Patterns that indicate the source wallet simply cannot pay for the transaction — the one
 * class of failure that funding the wallet and retrying actually resolves.
 */
const RETRYABLE_PATTERNS = [
  /insufficient funds/i,
  /insufficient balance/i,
  /gas required exceeds/i,
  /out of energy/i,
  /out_of_energy/i,
  /bandwidth/i,
  /account not found/i,
  /account does not exist/i,
  /balance is not sufficient/i,
]

/**
 * Classifies a send failure as worth retrying after a fee top-up, or terminal.
 *
 * Defaults to **terminal**: retrying an unknown failure costs a real gas transfer each time,
 * so the burden is on recognising a fundable condition rather than assuming one.
 */
export const isRetryableSendError = (message: string): boolean => RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))
