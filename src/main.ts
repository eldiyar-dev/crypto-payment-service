import { AppModule } from '@/infrastructure/modules/app.module'
import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import * as bodyParser from 'body-parser'
import * as basicAuth from 'express-basic-auth'
import * as fs from 'fs'
import helmet from 'helmet'
import { HttpMessageDto } from './common/dto/http.dto'
import { TConfiguration } from './infrastructure/config/configuration'
import { winstonConfig } from './infrastructure/config/logger.config'
import { TrimPipe } from './presentation/pipes/trim.pipe'

async function bootstrap() {
  const logger = new Logger()

  const app = await NestFactory.create(AppModule, {
    logger: winstonConfig,
  })

  // Without this, Nest's destroy/shutdown hooks never fire: every deploy dropped the in-memory
  // deposit queue and could kill a withdrawal after broadcast but before the ledger recorded
  // it, leaving money moved on-chain with no record. Monitors stop accepting new work on
  // SIGTERM and drain what is in flight.
  app.enableShutdownHooks()

  // A rejected promise that nothing handles is fatal under Node's default settings. On a
  // service that custodies funds, logging and staying up beats dying mid-withdrawal.
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`)
  })

  app.use(bodyParser.json({ limit: '4mb' }))
  app.use(bodyParser.urlencoded({ limit: '4mb', extended: true }))

  const configService = app.get(ConfigService<TConfiguration>)
  const port = configService.get<TConfiguration['port']>('port')!
  const swaggerPass = configService.get<TConfiguration['swaggerPass']>('swaggerPass')!

  app.use(helmet())

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    }),
    new TrimPipe(),
  )

  app.use(
    ['/swagger'],
    basicAuth({
      challenge: true,
      users: { admin: swaggerPass },
    }),
  )

  const config = new DocumentBuilder().setTitle('LLC Crypto API').setDescription('The API description').setVersion('1.0').addBearerAuth().build()
  const document = SwaggerModule.createDocument(app, config, { extraModels: [HttpMessageDto] })
  SwaggerModule.setup('swagger', app, document)
  fs.writeFileSync('./swagger.json', JSON.stringify(document))

  await app.listen(port)

  logger.log(`Application running on port ${port}`) // LOGGER OF TYPE LOG
}
void bootstrap()
