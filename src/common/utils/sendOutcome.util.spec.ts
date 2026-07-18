import { isRetryableSendError, sendFailed, sendSucceeded } from './sendOutcome.util'

describe('sendSucceeded / sendFailed', () => {
  it('carries the transaction hash on success', () => {
    expect(sendSucceeded('0xabc')).toEqual({ ok: true, txHash: '0xabc' })
  })

  it('defaults a failure to terminal', () => {
    expect(sendFailed('bad address')).toEqual({ ok: false, retryable: false, message: 'bad address' })
  })
})

describe('isRetryableSendError', () => {
  // These are the conditions a fee/energy top-up actually resolves.
  it.each([
    'insufficient funds for intrinsic transaction cost',
    'Insufficient balance for 0xabc',
    'gas required exceeds allowance',
    'OUT_OF_ENERGY',
    'account not found on chain',
    'balance is not sufficient',
    'not enough bandwidth',
  ])('classifies %s as retryable', (message) => {
    expect(isRetryableSendError(message)).toBe(true)
  })

  // Retrying these burns a real gas transfer and a second doomed attempt for nothing, which
  // is exactly what the old undifferentiated `null` return caused.
  it.each(['invalid address', 'nonce too low', 'execution reverted: ERC20: transfer amount exceeds balance', 'replacement transaction underpriced', ''])(
    'classifies %s as terminal',
    (message) => {
      expect(isRetryableSendError(message)).toBe(false)
    },
  )
})
