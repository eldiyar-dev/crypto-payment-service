import { TConfiguration } from '@/infrastructure/config/configuration'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'crypto'

interface ApiKeyPayload {
  clientId: string
  timestamp: number
  signature: string
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const apiKey = request.headers['x-api-key'] as string
    if (!apiKey) throw new UnauthorizedException('No API key provided')

    try {
      const payload = JSON.parse(Buffer.from(apiKey, 'base64').toString()) as ApiKeyPayload

      // check expiration time (1 day)
      if (Date.now() - payload.timestamp > 24 * 60 * 60 * 1000) throw new UnauthorizedException('API key expired')

      // check signature
      const apiKeySecret = this.configService.get<string>('api_key_secret')!
      const expectedSignature = createHmac('sha256', apiKeySecret).update(`${payload.clientId}${payload.timestamp}`).digest('hex')

      if (payload.signature !== expectedSignature) throw new UnauthorizedException('Invalid signature')

      // add client info to request
      request['clientId'] = payload.clientId

      return true
    } catch {
      throw new UnauthorizedException('Invalid API key')
    }
  }
}
