/** `transfer(address,uint256)` */
export const TRC20_TRANSFER_SELECTOR = 'a9059cbb'
/** `transferFrom(address,address,uint256)` */
export const TRC20_TRANSFER_FROM_SELECTOR = '23b872dd'

const SELECTOR_LEN = 8 // 4 bytes
const WORD_LEN = 64 // 32 bytes
const ADDRESS_OFFSET_IN_WORD = 24 // an address occupies the low 20 bytes of its word

export type Trc20Transfer = {
  /** Recipient, as a TRON hex address (0x41-prefixed, without the `0x`). */
  toAddressHex: string
  /** Amount in the token's base units. Exact. */
  amount: bigint
}

const wordAt = (data: string, index: number): string => {
  const start = SELECTOR_LEN + index * WORD_LEN
  return data.slice(start, start + WORD_LEN)
}

/**
 * Decodes a TRC20 `transfer` or `transferFrom` call's calldata.
 *
 * Argument layout after the 4-byte selector, each argument occupying one 32-byte word:
 * - `transfer(address to, uint256 value)`      -> word 0 = to,   word 1 = value
 * - `transferFrom(address from, address to, uint256 value)` -> word 0 = from, word 1 = to,
 *   word 2 = value
 *
 * The previous implementation read the `transferFrom` recipient from hex offset 76..116, which
 * is misaligned inside word 1, and then read the *amount* from 72..136 — which is word 1, i.e.
 * the recipient word, not the value. In practice the malformed address failed the allow-list
 * check, so `transferFrom`-delivered USDT deposits were silently missed entirely. The length
 * guard was also `< 136`, too short for `transferFrom` (which needs 200), and it was evaluated
 * *after* the slices had already been taken.
 *
 * @param data - Hex calldata, without a leading `0x`
 * @returns The decoded transfer, or null if this is not a recognised transfer call or the
 * calldata is too short to contain its arguments.
 */
export const decodeTrc20Transfer = (data: string): Trc20Transfer | null => {
  if (typeof data !== 'string') return null

  const isTransfer = data.startsWith(TRC20_TRANSFER_SELECTOR)
  const isTransferFrom = data.startsWith(TRC20_TRANSFER_FROM_SELECTOR)
  if (!isTransfer && !isTransferFrom) return null

  const argCount = isTransfer ? 2 : 3
  // Validate before slicing: a short payload otherwise yields a truncated address and a
  // nonsense amount rather than a clean rejection.
  if (data.length < SELECTOR_LEN + argCount * WORD_LEN) return null

  const toWord = isTransfer ? wordAt(data, 0) : wordAt(data, 1)
  const valueWord = isTransfer ? wordAt(data, 1) : wordAt(data, 2)

  const addressHex = toWord.slice(ADDRESS_OFFSET_IN_WORD)
  // The high bytes of an address word must be zero; anything else is not a valid address arg.
  if (!/^0+$/.test(toWord.slice(0, ADDRESS_OFFSET_IN_WORD))) return null
  if (!/^[0-9a-f]{40}$/i.test(addressHex)) return null
  if (!/^[0-9a-f]{64}$/i.test(valueWord)) return null

  return {
    // TRON addresses are 0x41-prefixed.
    toAddressHex: `41${addressHex}`,
    amount: BigInt(`0x${valueWord}`),
  }
}
