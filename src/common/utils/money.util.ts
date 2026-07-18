/**
 * Exact monetary arithmetic in base units.
 *
 * Every amount on the money path is carried as a `bigint` count of the currency's smallest
 * indivisible unit — wei, satoshi, sun, token micro-units — never as a JavaScript `number`.
 * An 18-decimal wei amount cannot round-trip through a double: `Number(formatEther(value))`
 * silently discards low-order wei, and the loss compounds through the split and the send.
 *
 * Decimal strings are produced only at the edges: logs, and the payloads sent to the client API.
 */

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

/** satoshi per BTC */
export const BTC_DECIMALS = 8
/** SUN per TRX */
export const TRX_DECIMALS = 6
/** TRC20 USDT on TRON */
export const TRON_USDT_DECIMALS = 6
/** wei per ETH — and per native coin on every EVM chain in `EVM_CHAINS` */
export const ETH_DECIMALS = 18

/**
 * Renders a base-unit amount as an exact decimal string.
 *
 * @param base - Amount in base units
 * @param decimals - Number of decimal places the currency uses
 * @returns An exact decimal string, e.g. `formatBaseUnits(1000000n, 6) === '1'`
 */
export const formatBaseUnits = (base: bigint, decimals: number): string => {
  const negative = base < 0n
  const digits = (negative ? -base : base).toString().padStart(decimals + 1, '0')

  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, '') : ''

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * Parses an exact decimal string into base units without passing through a float.
 *
 * @param value - A decimal string, e.g. `'0.001'`
 * @param decimals - Number of decimal places the currency uses
 * @returns The amount in base units
 * @throws {Error} If the input is not a plain decimal number, or carries more precision than
 * the currency can represent — truncating here would silently alter a customer amount.
 */
export const parseBaseUnits = (value: string, decimals: number): bigint => {
  const match = DECIMAL_PATTERN.exec(String(value).trim())
  if (!match) throw new Error(`Not an exact decimal amount: ${value}`)

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > decimals) throw new Error(`Amount ${value} carries more than ${decimals} decimal places`)

  const base = BigInt(whole + fraction.padEnd(decimals, '0'))
  return sign ? -base : base
}

/**
 * Converts a base-unit amount to a `number` for external payloads that require a JSON number.
 *
 * Lossy by definition — use only at the boundary, alongside the exact string form, and never
 * as an input to further arithmetic.
 */
export const toDisplayNumber = (base: bigint, decimals: number): number => Number(formatBaseUnits(base, decimals))
