import { AppModule } from '@/infrastructure/modules/app.module'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { App } from 'supertest/types'

/**
 * Generated Nest boilerplate. It has never run in this repository: it imported
 * `./../src/app.module`, which does not exist (the root module lives at
 * `src/infrastructure/modules/app.module.ts`), so the suite failed to compile — and it asserts
 * a `GET /` returning 'Hello World!', a route this service does not define.
 *
 * The import is repaired here so the repository typechecks. The suite stays skipped because
 * booting AppModule requires a live Postgres and Redis, plus PRIVATE_KEY_SECRET and a valid
 * https CLIENT_API_URL — it is not a unit-testable surface. It is left in place rather than
 * deleted so the absence of end-to-end coverage stays visible; see D-1 in FIXES-APPLIED.md.
 */
describe.skip('AppController (e2e) — requires Postgres, Redis and full env', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('rejects unauthenticated wallet creation', () => {
    return request(app.getHttpServer()).post('/wallets').send({ wallets: [] }).expect(401)
  })
})
