import { Logger as NestLogger } from '@nestjs/common'
import type { Logger as TypeOrmLoggerInterface } from 'typeorm'

/**
 * TypeORM logger that never emits query parameters.
 *
 * TypeORM's built-in loggers append the bound parameters to every logged statement — including
 * failed ones — which writes `Wallet.privateKey` into the log sinks on each INSERT. Queries
 * themselves are still useful for diagnosis, so the statement text is kept and only the
 * parameter array is dropped.
 */
export class RedactingTypeOrmLogger implements TypeOrmLoggerInterface {
  private readonly logger = new NestLogger('TypeORM')

  logQuery(query: string): void {
    this.logger.debug(query)
  }

  logQueryError(error: string | Error, query: string): void {
    const message = error instanceof Error ? error.message : error
    this.logger.error(`Query failed: ${message} — ${query}`)
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn(`Slow query (${time}ms): ${query}`)
  }

  logSchemaBuild(message: string): void {
    this.logger.log(message)
  }

  logMigration(message: string): void {
    this.logger.log(message)
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') this.logger.warn(String(message))
    else this.logger.log(String(message))
  }
}
