import { TConfiguration } from '@/infrastructure/config/configuration'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'

interface ApiKeyPayload {
  clientId: string
  timestamp: number
  signature: string
}

/** Keys older than this are rejected. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Tolerance for clock skew between the caller and this service. */
const MAX_SKEW_MS = 5 * 60 * 1000

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<TConfiguration>,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const apiKey = request.headers['x-api-key'] as string
    if (!apiKey) throw new UnauthorizedException('No API key provided')

    let payload: ApiKeyPayload
    try {
      payload = JSON.parse(Buffer.from(apiKey, 'base64').toString()) as ApiKeyPayload
    } catch {
      throw new UnauthorizedException('Invalid API key')
    }

    if (typeof payload?.clientId !== 'string' || typeof payload?.timestamp !== 'number' || typeof payload?.signature !== 'string') {
      throw new UnauthorizedException('Invalid API key')
    }

    // Two-sided window. The old check only bounded the *upper* age, so a future-dated
    // timestamp produced a negative difference and passed indefinitely — a key minted with
    // timestamp = year 3000 never expired.
    const age = Date.now() - payload.timestamp
    if (age > MAX_AGE_MS) throw new UnauthorizedException('API key expired')
    if (age < -MAX_SKEW_MS) throw new UnauthorizedException('API key timestamp is in the future')

    const apiKeySecret = this.configService.get<string>('api_key_secret')!
    const expectedSignature = createHmac('sha256', apiKeySecret).update(`${payload.clientId}${payload.timestamp}`).digest('hex')

    if (!this.signaturesMatch(payload.signature, expectedSignature)) throw new UnauthorizedException('Invalid signature')

    // Single-use within the validity window. Without this a captured key was replayable for
    // its full 24h lifetime.
    if (!(await this.redisService.claimApiKeyNonce(payload.signature, MAX_AGE_MS))) {
      throw new UnauthorizedException('API key has already been used')
    }

    // add client info to request
    request['clientId'] = payload.clientId

    return true
  }

  /**
   * Constant-time signature comparison.
   *
   * `!==` on strings short-circuits at the first differing byte, leaking how much of a guess
   * was correct and making the signature forgeable byte-by-byte given enough attempts.
   */
  private signaturesMatch(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')

    // timingSafeEqual throws on a length mismatch, which is itself an early exit — but the
    // length of a hex-encoded HMAC is not secret, so this is safe to check first.
    if (providedBuffer.length !== expectedBuffer.length) return false

    return timingSafeEqual(providedBuffer, expectedBuffer)
  }
}
