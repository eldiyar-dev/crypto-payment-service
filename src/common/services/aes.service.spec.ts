import { TConfiguration } from '@/infrastructure/config/configuration'
import { ConfigService } from '@nestjs/config'
import { AESCipherService } from './aes.service'

const configStub = (values: Partial<TConfiguration>): ConfigService<TConfiguration> =>
  ({ get: (key: keyof TConfiguration) => values[key] }) as unknown as ConfigService<TConfiguration>

const SECRET = 'test-private-key-secret'

// Representative key material for each supported chain family.
const EVM_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
const TRON_KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0'
const BTC_WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ'

describe('AESCipherService', () => {
  const service = new AESCipherService(configStub({ private_key_secret: SECRET, allow_legacy_plaintext_keys: false }))

  describe('encrypt/decrypt round-trip', () => {
    it.each([EVM_KEY, TRON_KEY, BTC_WIF])('round-trips key material without alteration: %s', (key) => {
      expect(service.decrypt(service.encrypt(key))).toBe(key)
    })

    it('produces a different ciphertext each time (random IV)', () => {
      expect(service.encrypt(EVM_KEY)).not.toBe(service.encrypt(EVM_KEY))
    })

    it('cannot be decrypted with a different secret', () => {
      const other = new AESCipherService(configStub({ private_key_secret: 'a-different-secret', allow_legacy_plaintext_keys: false }))
      expect(() => other.decrypt(service.encrypt(EVM_KEY))).toThrow()
    })
  })

  describe('isEncrypted', () => {
    it('recognises its own envelope', () => {
      expect(service.isEncrypted(service.encrypt(EVM_KEY))).toBe(true)
    })

    // The discriminator has to be exact: misclassifying plaintext as ciphertext strands funds,
    // misclassifying ciphertext as plaintext would broadcast a garbage key.
    it.each([EVM_KEY, TRON_KEY, BTC_WIF, '', 'not:hex', `${'a'.repeat(31)}:${'b'.repeat(8)}`, `${'a'.repeat(32)}:`, `${'a'.repeat(32)}:abc`])(
      'rejects non-envelope value: %s',
      (value) => {
        expect(service.isEncrypted(value)).toBe(false)
      },
    )
  })

  describe('decryptPrivateKey', () => {
    it('decrypts an encrypted row', () => {
      expect(service.decryptPrivateKey(service.encrypt(TRON_KEY), 'Taddr')).toBe(TRON_KEY)
    })

    it('refuses a legacy plaintext row when the escape hatch is disabled', () => {
      expect(service.decryptPrivateKey(TRON_KEY, 'Taddr')).toBeNull()
    })

    it('accepts a legacy plaintext row only when explicitly allowed', () => {
      const migrating = new AESCipherService(configStub({ private_key_secret: SECRET, allow_legacy_plaintext_keys: true }))
      expect(migrating.decryptPrivateKey(TRON_KEY, 'Taddr')).toBe(TRON_KEY)
    })

    it('returns null rather than throwing when ciphertext does not match the key', () => {
      const other = new AESCipherService(configStub({ private_key_secret: 'a-different-secret', allow_legacy_plaintext_keys: false }))
      expect(other.decryptPrivateKey(service.encrypt(EVM_KEY), '0xaddr')).toBeNull()
    })
  })

  it('refuses to construct without a key-encryption secret', () => {
    expect(() => new AESCipherService(configStub({}))).toThrow(/PRIVATE_KEY_SECRET/)
  })
})
