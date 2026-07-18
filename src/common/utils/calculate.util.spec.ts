import { ETH_DECIMALS, parseBaseUnits } from './money.util'
import { splitAmountByPercentage } from './calculate.util'

describe('splitAmountByPercentage', () => {
  describe('the conservation invariant', () => {
    // The defect this guards: computing each leg independently from the total
    // (total * pct and total * (100 - pct)) leaves the rounding residue unallocated, so the
    // legs no longer sum to the deposit and value silently disappears.
    it.each([
      [100n, 20],
      [1n, 20],
      [1n, 50],
      [3n, 50],
      [7n, 33.33],
      [999999999999999999n, 37.5],
      [1000000n, 0],
      [1000000n, 100],
      [0n, 42],
      [parseBaseUnits('1.234567890123456789', ETH_DECIMALS), 12.34],
    ])('legs sum to exactly the total for %s at %s%%', (total, pie) => {
      const { mainAmount, additionalAmount } = splitAmountByPercentage(total, pie)
      expect(mainAmount + additionalAmount).toBe(total)
    })

    it('holds across a sweep of totals and percentages', () => {
      for (let total = 0n; total <= 200n; total++) {
        for (const pie of [0, 0.01, 1, 12.5, 33.33, 50, 66.67, 99.99, 100]) {
          const { mainAmount, additionalAmount } = splitAmountByPercentage(total, pie)
          expect(mainAmount + additionalAmount).toBe(total)
          expect(mainAmount).toBeGreaterThanOrEqual(0n)
          expect(additionalAmount).toBeGreaterThanOrEqual(0n)
        }
      }
    })
  })

  describe('allocation', () => {
    it('splits an evenly divisible amount exactly', () => {
      expect(splitAmountByPercentage(100n, 20)).toEqual({ mainAmount: 80n, additionalAmount: 20n })
    })

    it('gives everything to main at 0% and to additional at 100%', () => {
      expect(splitAmountByPercentage(100n, 0)).toEqual({ mainAmount: 100n, additionalAmount: 0n })
      expect(splitAmountByPercentage(100n, 100)).toEqual({ mainAmount: 0n, additionalAmount: 100n })
    })

    // Documented dust policy: the additional leg truncates down, main keeps the remainder.
    it('assigns the rounding remainder to the main leg', () => {
      expect(splitAmountByPercentage(1n, 50)).toEqual({ mainAmount: 1n, additionalAmount: 0n })
      expect(splitAmountByPercentage(7n, 33.33)).toEqual({ mainAmount: 5n, additionalAmount: 2n })
    })

    it('honours fractional percentages to two decimal places', () => {
      expect(splitAmountByPercentage(10_000n, 12.34)).toEqual({ mainAmount: 8766n, additionalAmount: 1234n })
    })
  })

  describe('rejects unusable input rather than producing a bad leg', () => {
    // pie arrived unvalidated from the client API: undefined produced NaN legs (both falsy, so
    // funds silently never moved and no report was sent), and pie > 100 produced a negative
    // main leg that was still truthy, so a send was attempted with a negative amount.
    it.each([undefined, null, NaN, Infinity, -Infinity, -1, 101, '20'])('throws for percentage %s', (pie) => {
      expect(() => splitAmountByPercentage(100n, pie as number)).toThrow(/finite number in \[0, 100\]/)
    })

    it('throws for a negative total', () => {
      expect(() => splitAmountByPercentage(-1n, 20)).toThrow(/negative amount/)
    })
  })
})
