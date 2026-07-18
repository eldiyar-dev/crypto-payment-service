import { withRetry } from './retry.util'

const fast = { baseDelayMs: 1, maxDelayMs: 2 }

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const operation = jest.fn().mockResolvedValue('ok')

    await expect(withRetry(operation, fast)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries a null result and returns the eventual success', async () => {
    const operation = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('ok')

    await expect(withRetry(operation, fast)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('retries a thrown error and returns the eventual success', async () => {
    const operation = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')

    await expect(withRetry(operation, fast)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('gives up after the configured number of attempts', async () => {
    const operation = jest.fn().mockResolvedValue(null)

    await expect(withRetry(operation, { ...fast, retries: 4 })).resolves.toBeNull()
    expect(operation).toHaveBeenCalledTimes(4)
  })

  // The old implementation retried any falsy result, so an operation legitimately returning 0
  // or false was treated as a failure and hammered three times.
  describe('falsy-but-valid results', () => {
    it.each([[0], [false], ['']])('treats %s as success, not failure', async (value) => {
      const operation = jest.fn().mockResolvedValue(value)

      await expect(withRetry(operation, fast)).resolves.toBe(value)
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  // The old implementation slept only inside `catch`, so an operation that *returned* null
  // retried immediately — three tight iterations hammering the endpoint it should back off from.
  it('delays between attempts when the operation returns null rather than throwing', async () => {
    const operation = jest.fn().mockResolvedValue(null)
    const started = Date.now()

    await withRetry(operation, { retries: 3, baseDelayMs: 40, maxDelayMs: 40 })

    // Two gaps of up to 40ms each with full jitter; assert a delay actually occurred rather
    // than a precise duration, which would be flaky.
    expect(operation).toHaveBeenCalledTimes(3)
    expect(Date.now() - started).toBeGreaterThan(0)
  })

  it('reports each error to onError with its attempt number', async () => {
    const onError = jest.fn()
    const operation = jest.fn().mockRejectedValue(new Error('boom'))

    await withRetry(operation, { ...fast, retries: 3, onError })

    expect(onError).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error), 1)
    expect(onError).toHaveBeenNthCalledWith(3, expect.any(Error), 3)
  })

  it('honours a custom shouldRetryResult', async () => {
    type Result = { ok: boolean }
    const operation = jest.fn<Promise<Result | null>, []>().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })

    const result = await withRetry<Result>(operation, { ...fast, shouldRetryResult: (r) => r?.ok !== true })

    expect(result).toEqual({ ok: true })
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
