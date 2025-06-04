import { TConfiguration } from '@/infrastructure/config/configuration'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'

@Injectable()
export class IpWhitelistGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<TConfiguration>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const clientIp = request.ip!

    const whitelist = this.configService.get<string[]>('ip_whitelist')
    if (!whitelist?.includes(clientIp)) throw new UnauthorizedException('IP not allowed')

    return true
  }
}
