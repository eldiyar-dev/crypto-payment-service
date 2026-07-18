import { REDACTED, redactSensitive } from './redact.util'

describe('redactSensitive', () => {
  it('passes primitives through untouched', () => {
    expect(redactSensitive('plain message')).toBe('plain message')
    expect(redactSensitive(42)).toBe(42)
    expect(redactSensitive(null)).toBeNull()
  })

  it('redacts wallet key material regardless of key casing or prefix', () => {
    const result = redactSensitive({
      address: '0xabc',
      privateKey: 'deadbeef',
      fromAddressPrivateKey: 'deadbeef',
      mainSecret: 'deadbeef',
      private_key_secret: 'deadbeef',
    }) as Record<string, unknown>

    expect(result.address).toBe('0xabc')
    expect(result.privateKey).toBe(REDACTED)
    expect(result.fromAddressPrivateKey).toBe(REDACTED)
    expect(result.mainSecret).toBe(REDACTED)
    expect(result.private_key_secret).toBe(REDACTED)
  })

  // The withdraw_wallets response body is where the destination hot-wallet key lives, and it is
  // nested several levels deep inside a serialised axios error.
  it('redacts nested credentials inside an axios-shaped error payload', () => {
    const result = redactSensitive({
      config: { headers: { authorization: 'Bearer tok', apikey: 'k' }, params: { address: 'T1' } },
      response: { status: 500, data: { mainAddress: 'T2', mainSecret: 'hot-wallet-key', pie: 20 } },
    }) as any

    expect(result.config.headers.authorization).toBe(REDACTED)
    expect(result.config.headers.apikey).toBe(REDACTED)
    expect(result.config.params.address).toBe('T1')
    expect(result.response.status).toBe(500)
    expect(result.response.data.mainAddress).toBe('T2')
    expect(result.response.data.mainSecret).toBe(REDACTED)
    expect(result.response.data.pie).toBe(20)
  })

  it('redacts inside arrays', () => {
    const result = redactSensitive([{ privateKey: 'a' }, { address: 'b' }]) as any[]
    expect(result[0].privateKey).toBe(REDACTED)
    expect(result[1].address).toBe('b')
  })

  it('reduces Errors to name/message/stack so request payloads are not carried along', () => {
    const error = Object.assign(new Error('boom'), { config: { headers: { authorization: 'Bearer tok' } } })
    const result = redactSensitive(error) as Record<string, unknown>

    expect(result.message).toBe('boom')
    expect(result).not.toHaveProperty('config')
  })

  it('survives circular references and deep nesting without throwing', () => {
    const circular: Record<string, unknown> = { privateKey: 'x' }
    circular.self = circular
    expect(() => redactSensitive(circular)).not.toThrow()
    expect((redactSensitive(circular) as any).self).toBe('[CIRCULAR]')

    let deep: Record<string, unknown> = { privateKey: 'x' }
    for (let i = 0; i < 10; i++) deep = { nested: deep }
    expect(() => redactSensitive(deep)).not.toThrow()
  })
})
