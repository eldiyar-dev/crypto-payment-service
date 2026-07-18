import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'

const HEX = /^[0-9a-f]+$/i

/**
 * AESCipherService is a service that provides AES-256-CBC encryption and decryption
 * @description Used to encrypt/decrypt custodial wallet private keys at rest.
 * @example
 * const aesCipherService = new AESCipherService(configService)
 * const encrypted = aesCipherService.encrypt('text')
 */
@Injectable()
export class AESCipherService {
  private readonly logger = new Logger(AESCipherService.name)

  private readonly ALGORITHM = 'aes-256-cbc'
  private readonly IV_LENGTH = 16 // AES block size
  private readonly KEY: Buffer
  private readonly allowLegacyPlaintext: boolean

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    const privateKeySecret = this.configService.get<TConfiguration['private_key_secret']>('private_key_secret')
    // Fail closed: booting without a key-encryption secret would silently persist plaintext keys.
    if (!privateKeySecret) throw new Error('PRIVATE_KEY_SECRET is not configured — refusing to start without a key-encryption secret')

    this.KEY = crypto.scryptSync(privateKeySecret, 'salt', 32) // 32 bytes for AES-256
    this.allowLegacyPlaintext = this.configService.get<TConfiguration['allow_legacy_plaintext_keys']>('allow_legacy_plaintext_keys') ?? false
  }

  /**
   * Encrypts a text using AES-256-CBC
   * @param text - The text to encrypt
   * @returns The encrypted text as `ivHex:cipherHex`
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH)
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.KEY, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return iv.toString('hex') + ':' + encrypted
  }

  /**
   * Reports whether a stored value carries the `ivHex:cipherHex` envelope produced by {@link encrypt}.
   *
   * No private key format in use (EVM/TRON hex, BTC WIF base58) contains a colon, so the
   * envelope is an unambiguous discriminator between encrypted and legacy plaintext rows.
   */
  isEncrypted(value: string): boolean {
    if (typeof value !== 'string') return false

    const parts = value.split(':')
    if (parts.length !== 2) return false

    const [ivHex, cipherHex] = parts
    if (ivHex.length !== this.IV_LENGTH * 2 || !HEX.test(ivHex)) return false

    return cipherHex.length > 0 && cipherHex.length % 2 === 0 && HEX.test(cipherHex)
  }

  /**
   * Decrypts an encrypted text using AES-256-CBC
   * @param encrypted - The encrypted text in `ivHex:cipherHex` form
   * @returns The decrypted text
   * @throws {Error} If the input is not a well-formed envelope or the key/IV does not match
   */
  decrypt(encrypted: string): string {
    if (!this.isEncrypted(encrypted)) throw new Error('Malformed ciphertext: expected `ivHex:cipherHex`')

    const [ivHex, encryptedText] = encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.KEY, iv)
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
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
}
