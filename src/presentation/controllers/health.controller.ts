import { HttpMessageDto } from '@/common/dto/http.dto'
import { Controller, Get } from '@nestjs/common'
import { ApiInternalServerErrorResponse, ApiTags } from '@nestjs/swagger'
import { HealthCheckService, HttpHealthIndicator, HealthCheck } from '@nestjs/terminus'

/**
 * Health controller class
 */
@ApiTags('Health')
@ApiInternalServerErrorResponse({ type: HttpMessageDto })
@Controller('health')
export class HealthController {
  /**
   * Health check controller class constructor.
   * @param health health check service
   * @param http http response
   */
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
  ) {}

  /**
   * Checks the liveness of the project
   * @returns http response
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.http.pingCheck('nestjs-docs', 'https://docs.nestjs.com')])
  }
}
