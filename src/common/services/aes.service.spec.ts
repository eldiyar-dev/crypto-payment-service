import { TConfiguration } from '@/infrastructure/config/configuration'
import * as crypto from 'crypto'
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

  describe('AES-256-GCM envelope', () => {
    it('emits the versioned v2 envelope', () => {
      expect(service.encrypt(EVM_KEY).startsWith('v2:')).toBe(true)
    })

    it('uses a different salt per record, so no two records share a key', () => {
      const [, saltA] = service.encrypt(EVM_KEY).split(':')
      const [, saltB] = service.encrypt(EVM_KEY).split(':')
      expect(saltA).not.toBe(saltB)
    })

    // CBC is malleable: with database write access an attacker could alter a ciphertext and
    // the service would decrypt the result without noticing. GCM's tag makes that fail closed.
    it('rejects a tampered ciphertext instead of returning altered key material', () => {
      const parts = service.encrypt(EVM_KEY).split(':')
      const cipherHex = parts[4]
      // Flip one byte of ciphertext.
      const flipped = (parseInt(cipherHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0')
      parts[4] = flipped + cipherHex.slice(2)

      expect(() => service.decrypt(parts.join(':'))).toThrow()
    })

    it('rejects a tampered auth tag', () => {
      const parts = service.encrypt(EVM_KEY).split(':')
      parts[3] = 'f'.repeat(32)
      expect(() => service.decrypt(parts.join(':'))).toThrow()
    })
  })

  describe('legacy v1 (CBC) envelopes', () => {
    // Rows written by the previous implementation must stay spendable, or their funds strand.
    const legacyV1 = (secret: string, plaintext: string): string => {
      const key = crypto.scryptSync(secret, 'salt', 32)
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
      return iv.toString('hex') + ':' + cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
    }

    it('still decrypts a v1 envelope', () => {
      expect(service.decrypt(legacyV1(SECRET, TRON_KEY))).toBe(TRON_KEY)
    })

    it('recognises a v1 envelope as encrypted', () => {
      expect(service.isEncrypted(legacyV1(SECRET, TRON_KEY))).toBe(true)
    })

    it('flags v1 rows as needing re-encryption, and v2 rows as not', () => {
      expect(service.needsReEncryption(legacyV1(SECRET, TRON_KEY))).toBe(true)
      expect(service.needsReEncryption(service.encrypt(TRON_KEY))).toBe(false)
      expect(service.needsReEncryption(TRON_KEY)).toBe(false)
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
