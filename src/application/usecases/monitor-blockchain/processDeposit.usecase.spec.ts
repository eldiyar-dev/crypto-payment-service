import { Chain, Currency } from '@/common/enums'
import { Deposit } from '@/domain/entities/deposit.entity'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { DepositService } from '@/infrastructure/clientApi/deposit.service'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { ConfigService } from '@nestjs/config'
import { SplitWithdrawUseCase } from '../autoWithdraw/splitWithdraw.usecase'
import { ProcessDepositUseCase, TProcessDepositParams } from './processDeposit.usecase'

const DEPOSIT: TProcessDepositParams = {
  chain: Chain.ETH,
  currency: Currency.ETH,
  address: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
  amount: 1_000_000_000_000_000_000n,
  decimals: 18,
  txHash: '0xabc',
  outputIndex: 0,
}

type Overrides = {
  claimed?: Deposit | null
  sweeping?: boolean
  withdraw?: unknown
  alreadySwept?: bigint
  limits?: Partial<TConfiguration['sweep_limits']>
}

const build = (overrides: Overrides = {}) => {
  const depositRepository = {
    claimDetected: jest.fn().mockResolvedValue(overrides.claimed === undefined ? ({ id: 1 } as Deposit) : overrides.claimed),
    markSweeping: jest.fn().mockResolvedValue(overrides.sweeping ?? true),
    markSwept: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markHeld: jest.fn().mockResolvedValue(true),
    sumSweptSince: jest.fn().mockResolvedValue(overrides.alreadySwept ?? 0n),
  }
  const depositService = { notifyNewDeposit: jest.fn().mockResolvedValue(undefined) }
  const reportService = { sendReport: jest.fn().mockResolvedValue(undefined) }
  const splitWithdrawUseCase = {
    execute: overrides.withdraw instanceof Error ? jest.fn().mockRejectedValue(overrides.withdraw) : jest.fn().mockResolvedValue(overrides.withdraw ?? { success: true }),
  }
  const sweepLimits = { maxAutoSweep: {}, hourlyTotal: {}, ...overrides.limits }
  const configService = { get: (key: string) => (key === 'sweep_limits' ? sweepLimits : undefined) }

  const useCase = new ProcessDepositUseCase(
    depositRepository as unknown as DepositRepository,
    depositService as unknown as DepositService,
    splitWithdrawUseCase as unknown as SplitWithdrawUseCase,
    reportService as unknown as ReportService,
    configService as unknown as ConfigService<TConfiguration>,
  )

  return { useCase, depositRepository, depositService, splitWithdrawUseCase, reportService }
}

describe('ProcessDepositUseCase', () => {
  it('records the deposit before any funds move', async () => {
    const { useCase, depositRepository, splitWithdrawUseCase } = build()

    await useCase.execute(DEPOSIT)

    expect(depositRepository.claimDetected).toHaveBeenCalledWith(expect.objectContaining({ chain: Chain.ETH, txHash: '0xabc', outputIndex: 0, amountBaseUnits: DEPOSIT.amount }))
    // Ordering is the safety property: the row must exist before the sweep is attempted.
    expect(depositRepository.claimDetected.mock.invocationCallOrder[0]).toBeLessThan(splitWithdrawUseCase.execute.mock.invocationCallOrder[0])
  })

  // The core double-spend guard: a re-delivered deposit must not produce a second withdrawal.
  it('does not sweep a deposit that was already recorded', async () => {
    const { useCase, depositRepository, depositService, splitWithdrawUseCase } = build({ claimed: null })

    await useCase.execute(DEPOSIT)

    expect(splitWithdrawUseCase.execute).not.toHaveBeenCalled()
    expect(depositService.notifyNewDeposit).not.toHaveBeenCalled()
    expect(depositRepository.markSweeping).not.toHaveBeenCalled()
  })

  it('does not sweep when the DETECTED -> SWEEPING compare-and-swap loses', async () => {
    const { useCase, splitWithdrawUseCase } = build({ sweeping: false })

    await useCase.execute(DEPOSIT)

    expect(splitWithdrawUseCase.execute).not.toHaveBeenCalled()
  })

  it('marks the deposit swept when every leg completed', async () => {
    const { useCase, depositRepository } = build({ withdraw: { success: true } })

    await useCase.execute(DEPOSIT)

    expect(depositRepository.markSwept).toHaveBeenCalledWith(1)
    expect(depositRepository.markFailed).not.toHaveBeenCalled()
  })

  // A failed sweep recorded as swept is the failure mode that makes reconciliation impossible.
  it('marks the deposit failed, with the reason, when a leg did not complete', async () => {
    const { useCase, depositRepository } = build({ withdraw: { success: false, reason: 'Withdrawal incomplete (additional: sent, main: failed)' } })

    await useCase.execute(DEPOSIT)

    expect(depositRepository.markFailed).toHaveBeenCalledWith(1, 'Withdrawal incomplete (additional: sent, main: failed)')
    expect(depositRepository.markSwept).not.toHaveBeenCalled()
  })

  it('never leaves the row in SWEEPING when the sweep throws', async () => {
    const { useCase, depositRepository } = build({ withdraw: new Error('rpc exploded') })

    await useCase.execute(DEPOSIT)

    expect(depositRepository.markFailed).toHaveBeenCalledWith(1, expect.stringContaining('rpc exploded'))
    expect(depositRepository.markSwept).not.toHaveBeenCalled()
  })

  it('does not let a client API notification failure block the sweep', async () => {
    const { useCase, depositService, depositRepository } = build()
    depositService.notifyNewDeposit.mockRejectedValue(new Error('client api down'))

    await useCase.execute(DEPOSIT)

    expect(depositRepository.markSwept).toHaveBeenCalledWith(1)
  })

  it('keeps two outputs of one transaction distinct', async () => {
    const { useCase, depositRepository } = build()

    await useCase.execute({ ...DEPOSIT, chain: Chain.BTC, currency: Currency.BTC, outputIndex: 0 })
    await useCase.execute({ ...DEPOSIT, chain: Chain.BTC, currency: Currency.BTC, outputIndex: 3 })

    expect(depositRepository.claimDetected).toHaveBeenNthCalledWith(1, expect.objectContaining({ outputIndex: 0 }))
    expect(depositRepository.claimDetected).toHaveBeenNthCalledWith(2, expect.objectContaining({ outputIndex: 3 }))
  })

  // No independent control otherwise limits automated fund movement: every detected deposit
  // triggers an outbound transfer to a destination supplied by an external API.
  describe('automated-outflow limits', () => {
    it('sweeps normally when no limits are configured', async () => {
      const { useCase, depositRepository, splitWithdrawUseCase } = build()

      await useCase.execute(DEPOSIT)

      expect(depositRepository.markHeld).not.toHaveBeenCalled()
      expect(splitWithdrawUseCase.execute).toHaveBeenCalled()
    })

    it('holds a deposit above the per-deposit ceiling instead of sweeping it', async () => {
      const { useCase, depositRepository, splitWithdrawUseCase, reportService } = build({ limits: { maxAutoSweep: { ETH: '0.5' } as never } })

      await useCase.execute(DEPOSIT) // 1 ETH

      expect(depositRepository.markHeld).toHaveBeenCalledWith(1, expect.stringContaining('per-deposit auto-sweep ceiling'))
      expect(splitWithdrawUseCase.execute).not.toHaveBeenCalled()
      expect(reportService.sendReport).toHaveBeenCalled()
    })

    it('allows a deposit at exactly the ceiling', async () => {
      const { useCase, depositRepository, splitWithdrawUseCase } = build({ limits: { maxAutoSweep: { ETH: '1' } as never } })

      await useCase.execute(DEPOSIT)

      expect(depositRepository.markHeld).not.toHaveBeenCalled()
      expect(splitWithdrawUseCase.execute).toHaveBeenCalled()
    })

    it('holds when the rolling hourly total would be exceeded', async () => {
      const { useCase, depositRepository, splitWithdrawUseCase } = build({
        limits: { hourlyTotal: { ETH: '10' } as never },
        alreadySwept: 9_500_000_000_000_000_000n, // 9.5 ETH already swept this hour
      })

      await useCase.execute(DEPOSIT) // +1 ETH would reach 10.5

      expect(depositRepository.markHeld).toHaveBeenCalledWith(1, expect.stringContaining('hourly'))
      expect(splitWithdrawUseCase.execute).not.toHaveBeenCalled()
    })

    it('sweeps when the hourly total stays within the limit', async () => {
      const { useCase, splitWithdrawUseCase } = build({
        limits: { hourlyTotal: { ETH: '10' } as never },
        alreadySwept: 1_000_000_000_000_000_000n,
      })

      await useCase.execute(DEPOSIT)

      expect(splitWithdrawUseCase.execute).toHaveBeenCalled()
    })

    it('ignores a malformed limit rather than blocking every sweep', async () => {
      const { useCase, splitWithdrawUseCase } = build({ limits: { maxAutoSweep: { ETH: 'not-a-number' } as never } })

      await useCase.execute(DEPOSIT)

      expect(splitWithdrawUseCase.execute).toHaveBeenCalled()
    })
  })
})
