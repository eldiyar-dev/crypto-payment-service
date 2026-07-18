import { Chain } from '@/common/enums'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { ConfigService } from '@nestjs/config'
import { WithdrawService } from './withdraw.service'

const configStub = (values: Partial<TConfiguration> = {}): ConfigService<TConfiguration> =>
  ({ get: (key: keyof TConfiguration) => values[key] }) as unknown as ConfigService<TConfiguration>

const TRON_MAIN = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
const TRON_ADDITIONAL = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL'
const SOURCE = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb'

const validBody = { mainAddress: TRON_MAIN, additionalAddress: TRON_ADDITIONAL, mainSecret: 'hot-wallet-key', pie: 20 }

/** Builds a service with a stubbed transport, bypassing the real https/timeout wiring. */
const buildService = (responseData: unknown) => {
  const service = new WithdrawService(configStub())
  const get = jest.fn().mockResolvedValue({ data: responseData })
  ;(service as unknown as { http: { get: jest.Mock } }).http = { get }
  return { service, get }
}

describe('WithdrawService.getWithdrawWallets', () => {
  it('maps mainSecret to mainPrivateKey on a valid response', async () => {
    const { service } = buildService(validBody)

    await expect(service.getWithdrawWallets(Chain.TRON, SOURCE)).resolves.toEqual({
      mainAddress: TRON_MAIN,
      additionalAddress: TRON_ADDITIONAL,
      mainPrivateKey: 'hot-wallet-key',
      pie: 20,
    })
  })

  // This response decides where every deposit goes; a malformed destination is an
  // irrecoverable send, so nothing partially-valid may be returned.
  describe('rejects malformed destinations', () => {
    it.each([
      ['mainAddress not a TRON address', { ...validBody, mainAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }],
      ['additionalAddress with a bad checksum', { ...validBody, additionalAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv9' }],
      ['mainAddress missing', { ...validBody, mainAddress: undefined }],
      ['mainSecret missing', { ...validBody, mainSecret: undefined }],
      ['mainSecret empty', { ...validBody, mainSecret: '' }],
      ['body not an object', 'nope'],
      ['body undefined', undefined],
    ])('returns null when %s', async (_label, body) => {
      const { service } = buildService(body)
      await expect(service.getWithdrawWallets(Chain.TRON, SOURCE)).resolves.toBeNull()
    })
  })

  // pie flows straight into the split: undefined produced NaN legs (funds silently never moved,
  // with no report), and pie > 100 produced a negative leg that was still attempted.
  describe('rejects out-of-range pie', () => {
    it.each([
      ['undefined', undefined],
      ['a string', '20'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['negative', -1],
      ['above 100', 101],
    ])('returns null when pie is %s', async (_label, pie) => {
      const { service } = buildService({ ...validBody, pie })
      await expect(service.getWithdrawWallets(Chain.TRON, SOURCE)).resolves.toBeNull()
    })

    it.each([0, 50, 100])('accepts boundary pie value %s', async (pie) => {
      const { service } = buildService({ ...validBody, pie })
      await expect(service.getWithdrawWallets(Chain.TRON, SOURCE)).resolves.toMatchObject({ pie })
    })
  })

  it('returns null instead of throwing when the request fails', async () => {
    const service = new WithdrawService(configStub())
    ;(service as unknown as { http: { get: jest.Mock } }).http = { get: jest.fn().mockRejectedValue(new Error('timeout of 10000ms exceeded')) }

    await expect(service.getWithdrawWallets(Chain.TRON, SOURCE)).resolves.toBeNull()
  })
})
