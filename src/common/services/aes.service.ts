import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'

/**
 * AESCipherService is a service that provides AES-256-CBC encryption and decryption
 * @description This service is used to encrypt and decrypt text using AES-256-CBC
 * @example
 * const aesCipherService = new AESCipherService(configService)
 * const encrypted = aesCipherService.encrypt('text')
 */
@Injectable()
export class AESCipherService {
  private readonly ALGORITHM = 'aes-256-cbc'
  private readonly IV_LENGTH = 16 // AES block size
  private readonly KEY: Buffer

  constructor(private readonly configService: ConfigService<TConfiguration>) {
    const privateKeySecret = this.configService.get<TConfiguration['private_key_secret']>('private_key_secret')!
    this.KEY = crypto.scryptSync(privateKeySecret, 'salt', 32) // 32 bytes for AES-256
  }

  /**
   * Encrypts a text using AES-256-CBC
   * @param text - The text to encrypt
   * @returns The encrypted text
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH)
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.KEY, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return iv.toString('hex') + ':' + encrypted
  }

  /**
   * Decrypts an encrypted text using AES-256-CBC
   * @param encrypted - The encrypted text
   * @returns The decrypted text
   */
  decrypt(encrypted: string): string {
    const [ivHex, encryptedText] = encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.KEY, iv)
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
}
