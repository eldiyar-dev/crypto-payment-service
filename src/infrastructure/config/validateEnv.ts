import { Logger } from '@nestjs/common'

/**
 * Variables the service cannot safely run without.
 *
 * There was no configuration validation anywhere: a missing value surfaced as `undefined`
 * deep inside a request — an unauthenticated guard, an unencrypted key, a request to
 * `undefined/api/withdraw_wallets`. Failing at boot with a named variable is both faster to
 * diagnose and safer than discovering it mid-withdrawal.
 */
const REQUIRED = [
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'REDIS_HOST',
  'REDIS_PORT',
  // Without this, custodial private keys cannot be encrypted at rest.
  'PRIVATE_KEY_SECRET',
  // Without this, the wallet endpoint's API-key guard has nothing to verify against.
  'API_KEY_SECRET',
  'CLIENT_API_URL',
] as const

/**
 * Variables whose absence is not fatal but removes a protection, so it must be visible.
 */
const RECOMMENDED: Array<{ name: string; consequence: string }> = [
  { name: 'CLIENT_API_KEY', consequence: 'requests to the client API are unauthenticated' },
  { name: 'IP_WHITELIST', consequence: 'the IP allow-list guard rejects every request' },
  { name: 'SWAGGER_PASS', consequence: '/swagger is not exposed' },
]

/**
 * Validates configuration at boot.
 *
 * @throws {Error} listing every missing required variable at once, rather than one per restart.
 */
export const validateEnv = (logger: Logger): void => {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)

  for (const { name, consequence } of RECOMMENDED) {
    if (!process.env[name]) logger.warn(`${name} is not set — ${consequence}`)
  }

  if (process.env.ALLOW_LEGACY_PLAINTEXT_KEYS === 'true') {
    logger.error(
      'ALLOW_LEGACY_PLAINTEXT_KEYS is enabled — plaintext private keys will be accepted. This is a migration-only setting; unset it once every key is encrypted and rotated.',
    )
  }

  if (process.env.ALLOW_INSECURE_CLIENT_API === 'true') {
    logger.error('ALLOW_INSECURE_CLIENT_API is enabled — client API traffic may be unencrypted. This is a development-only setting.')
  }
}
