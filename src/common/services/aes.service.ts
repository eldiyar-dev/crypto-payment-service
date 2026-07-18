import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'

const HEX = /^[0-9a-f]+$/i

/** Current envelope version. Anything else is treated as legacy v1 (`ivHex:cipherHex`). */
const V2_PREFIX = 'v2'

const V2_SALT_BYTES = 16
const V2_IV_BYTES = 12 // GCM standard nonce length
const V2_TAG_BYTES = 16

/**
 * Encrypts and decrypts custodial wallet private keys at rest.
 *
 * **v2 (current)** — `v2:saltHex:ivHex:tagHex:cipherHex`, AES-256-GCM.
 * - *Authenticated.* CBC is malleable: anyone with database write access could tamper with a
 *   ciphertext and the service would decrypt the result without noticing. GCM's tag makes
 *   tampering a decryption failure.
 * - *Per-record salt.* The old construction derived the key with a hardcoded salt `'salt'`, so
 *   the same passphrase produced an identical key in every environment and every record shared
 *   one key. Each record now derives its own key from a random salt.
 * - The passphrase is stretched with scrypt **once** at construction; per-record keys come from
 *   HKDF, which is fast. Doing scrypt per record would make a bulk wallet import take minutes.
 *
 * **v1 (legacy)** — `ivHex:cipherHex`, AES-256-CBC with the hardcoded salt. Still decryptable so
 * existing rows remain spendable; re-encrypting them is a migration step, and every key that
 * was ever stored under v1 should be treated as compromised and rotated regardless.
 */
@Injectable()
export class AESCipherService {
  private readonly logger = new Logger(AESCipherService.name)

  private readonly LEGACY_ALGORITHM = 'aes-256-cbc'
  private readonly LEGACY_IV_LENGTH = 16
  private readonly LEGACY_KEY: Buffer

  private readonly ALGORITHM = 'aes-256-gcm'
  private readonly MASTER_KEY: Buffer

  private readonly allowLegacyPlaintext: boolean

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    const privateKeySecret = this.configService.get<TConfiguration['private_key_secret']>('private_key_secret')
    // Fail closed: booting without a key-encryption secret would silently persist plaintext keys.
    if (!privateKeySecret) throw new Error('PRIVATE_KEY_SECRET is not configured — refusing to start without a key-encryption secret')

    // Stretched once. Per-record separation comes from HKDF below, not from re-running scrypt.
    this.MASTER_KEY = crypto.scryptSync(privateKeySecret, 'crypto-payment-service:key-encryption:v2', 32)
    this.LEGACY_KEY = crypto.scryptSync(privateKeySecret, 'salt', 32)

    this.allowLegacyPlaintext = this.configService.get<TConfiguration['allow_legacy_plaintext_keys']>('allow_legacy_plaintext_keys') ?? false
  }

  /** Derives a record-specific key from the master key and that record's salt. */
  private deriveKey(salt: Buffer): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', this.MASTER_KEY, salt, 'wallet-private-key', 32))
  }

  /**
   * Encrypts a text using AES-256-GCM with a per-record salt.
   *
   * @param text - The text to encrypt
   * @returns `v2:saltHex:ivHex:tagHex:cipherHex`
   */
  encrypt(text: string): string {
    const salt = crypto.randomBytes(V2_SALT_BYTES)
    const iv = crypto.randomBytes(V2_IV_BYTES)
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.deriveKey(salt), iv)

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return [V2_PREFIX, salt.toString('hex'), iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
  }

  /**
   * Reports whether a stored value is one of the ciphertext envelopes.
   *
   * No private key format in use (EVM/TRON hex, BTC WIF base58) contains a colon, so this is an
   * unambiguous discriminator between encrypted and legacy plaintext rows.
   */
  isEncrypted(value: string): boolean {
    if (typeof value !== 'string') return false

    const parts = value.split(':')
    if (parts[0] === V2_PREFIX) return this.isValidV2(parts)

    return this.isValidV1(parts)
  }

  private isValidV2(parts: string[]): boolean {
    if (parts.length !== 5) return false

    const [, saltHex, ivHex, tagHex, cipherHex] = parts
    if (saltHex.length !== V2_SALT_BYTES * 2 || !HEX.test(saltHex)) return false
    if (ivHex.length !== V2_IV_BYTES * 2 || !HEX.test(ivHex)) return false
    if (tagHex.length !== V2_TAG_BYTES * 2 || !HEX.test(tagHex)) return false

    return cipherHex.length > 0 && cipherHex.length % 2 === 0 && HEX.test(cipherHex)
  }

  private isValidV1(parts: string[]): boolean {
    if (parts.length !== 2) return false

    const [ivHex, cipherHex] = parts
    if (ivHex.length !== this.LEGACY_IV_LENGTH * 2 || !HEX.test(ivHex)) return false

    return cipherHex.length > 0 && cipherHex.length % 2 === 0 && HEX.test(cipherHex)
  }

  /**
   * Decrypts a v2 or legacy v1 envelope.
   *
   * @throws {Error} If the input is not a well-formed envelope, the key does not match, or —
   * for v2 — the ciphertext has been tampered with.
   */
  decrypt(encrypted: string): string {
    const parts = String(encrypted).split(':')

    if (parts[0] === V2_PREFIX) {
      if (!this.isValidV2(parts)) throw new Error('Malformed ciphertext: expected `v2:saltHex:ivHex:tagHex:cipherHex`')

      const [, saltHex, ivHex, tagHex, cipherHex] = parts
      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.deriveKey(Buffer.from(saltHex, 'hex')), Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))

      // final() throws if the tag does not verify, so tampering fails closed.
      return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8')
    }

    if (!this.isValidV1(parts)) throw new Error('Malformed ciphertext: expected `ivHex:cipherHex`')

    const [ivHex, cipherHex] = parts
    const decipher = crypto.createDecipheriv(this.LEGACY_ALGORITHM, this.LEGACY_KEY, Buffer.from(ivHex, 'hex'))

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  /**
   * Resolves a stored `Wallet.privateKey` to usable key material.
   *
   * Rows written before encryption existed hold plaintext. Hard-failing on them would strand
   * every legacy wallet's funds, so they are accepted only while `ALLOW_LEGACY_PLAINTEXT_KEYS`
   * is set, and every such read is logged at error level so the backlog is visible and can be
   * migrated + rotated. Once migration completes, unset the flag to fail closed.
   *
   * @param stored - The value held in `Wallet.privateKey`
   * @param address - Wallet address, for operator-actionable logging only
   * @returns Decrypted key material, or null if it cannot be resolved safely
   */
  decryptPrivateKey(stored: string, address: string): string | null {
    if (this.isEncrypted(stored)) {
      try {
        return this.decrypt(stored)
      } catch (error) {
        this.logger.error(`Failed to decrypt private key for ${address}: ${(error as Error).message}`)
        return null
      }
    }

    if (!this.allowLegacyPlaintext) {
      this.logger.error(`Private key for ${address} is not encrypted and ALLOW_LEGACY_PLAINTEXT_KEYS is disabled — refusing to use it`)
      return null
    }

    this.logger.error(`SECURITY: wallet ${address} holds a PLAINTEXT private key — migrate and rotate this key`)
    return stored
  }

  /** True when a stored value uses the superseded v1 (CBC) envelope and should be re-encrypted. */
  needsReEncryption(stored: string): boolean {
    return this.isEncrypted(stored) && !stored.startsWith(`${V2_PREFIX}:`)
  }
}
