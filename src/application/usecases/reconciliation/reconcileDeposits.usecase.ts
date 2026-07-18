import { Chain, Currency } from '@/common/enums'
import { formatBaseUnits, isEvmNetwork, toDisplayNumber } from '@/common/utils'
import { Deposit, DepositStatus } from '@/domain/entities/deposit.entity'
import { DepositRepository } from '@/domain/repositories/depositRepository'
import { BtcInfoService } from '@/infrastructure/blockchain/btc'
import { EthInfoService } from '@/infrastructure/blockchain/eth/ethInfo.service'
import { TronInfoService } from '@/infrastructure/blockchain/tron'
import { ReportService } from '@/infrastructure/clientApi/report.service'
import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LessThan, Not } from 'typeorm'

/** A deposit still unswept after this long is stuck and needs attention. */
const STUCK_AFTER_MS = 15 * 60 * 1000
const INTERVAL_MS = 5 * 60 * 1000
const MAX_BALANCE_CHECKS_PER_PASS = 50

/**
 * Periodic reconciliation of the deposit ledger against the chain.
 *
 * There was previously no job, endpoint or query anywhere comparing expected state to
 * on-chain reality — no drift detection, no sweep-completeness check, no alerting on stuck
 * funds. It could not even be done manually, because no deposit ledger existed (A-1).
 *
 * Each pass:
 * 1. Reports how many deposits sit in each state.
 * 2. Flags deposits stuck in DETECTED or SWEEPING past a threshold. SWEEPING is the serious
 *    one: it means an outbound transfer may have been broadcast and then the process died,
 *    so it must be reconciled against the chain by a human rather than retried blindly.
 * 3. For unresolved deposits, checks whether the source address still holds a balance —
 *    that is money the service was supposed to move and did not.
 */
@Injectable()
export class ReconcileDepositsUseCase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcileDepositsUseCase.name)

  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly depositRepository: DepositRepository,
    private readonly reportService: ReportService,
    private readonly ethInfoService: EthInfoService,
    private readonly tronInfoService: TronInfoService,
    private readonly btcInfoService: BtcInfoService,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS)
    this.logger.log(`Deposit reconciliation scheduled every ${INTERVAL_MS / 1000}s`)
  }

  onApplicationShutdown() {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = null
  }

  async run(): Promise<void> {
    try {
      await this.reportStateCounts()

      const unresolved = await this.findUnresolved()
      if (!unresolved.length) return

      this.logger.error(`Reconciliation: ${unresolved.length} deposit(s) unresolved`)

      for (const deposit of unresolved.slice(0, MAX_BALANCE_CHECKS_PER_PASS)) {
        await this.inspect(deposit)
      }
    } catch (error) {
      this.logger.error(`Reconciliation pass failed: ${(error as Error).message}`)
    }
  }

  private async reportStateCounts(): Promise<void> {
    const counts = await this.depositRepository
      .createQueryBuilder('deposit')
      .select('deposit.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('deposit.status')
      .getRawMany<{ status: DepositStatus; count: string }>()

    const summary = counts.map(({ status, count }) => `${status}=${count}`).join(' ')
    this.logger.log(`Deposit ledger: ${summary || 'empty'}`)
  }

  /**
   * Deposits that should have completed by now: still awaiting a sweep, mid-sweep, or failed.
   */
  private async findUnresolved(): Promise<Deposit[]> {
    return this.depositRepository.find({
      where: [
        { status: DepositStatus.DETECTED, created_at: LessThan(new Date(Date.now() - STUCK_AFTER_MS)) },
        { status: DepositStatus.SWEEPING, created_at: LessThan(new Date(Date.now() - STUCK_AFTER_MS)) },
        { status: DepositStatus.FAILED, created_at: Not(LessThan(new Date(0))) },
      ],
      order: { created_at: 'ASC' },
      take: 500,
    })
  }

  private async inspect(deposit: Deposit): Promise<void> {
    const amount = BigInt(deposit.amountBaseUnits)
    const label = `deposit #${deposit.id} ${deposit.chain} ${deposit.txHash} -> ${deposit.address}`

    if (deposit.status === DepositStatus.SWEEPING) {
      // The dangerous state: a transfer may already be on-chain. Never auto-retry this.
      this.logger.error(`RECONCILE: ${label} has been SWEEPING since ${deposit.created_at?.toISOString()} — a transfer may be in flight; verify on-chain before any manual retry`)
    }

    const balance = await this.balanceOf(deposit)
    if (balance === null) {
      this.logger.warn(`RECONCILE: ${label} — could not read on-chain balance`)
      return
    }

    if (balance === 0n) {
      this.logger.log(`RECONCILE: ${label} status=${deposit.status} but source address is empty; funds appear to have moved`)
      return
    }

    this.logger.error(`RECONCILE: ${label} status=${deposit.status} and source still holds ${formatBaseUnits(balance, deposit.decimals)} ${deposit.currency} — funds are stranded`)

    await this.reportService.sendReport({
      currency: deposit.currency,
      address: deposit.address,
      amount: toDisplayNumber(amount, deposit.decimals),
      amountExact: formatBaseUnits(amount, deposit.decimals),
      message: `Reconciliation: deposit ${deposit.txHash} is ${deposit.status} and the source address still holds ${formatBaseUnits(balance, deposit.decimals)} ${deposit.currency}`,
    })
  }

  /** Balance of the deposit's source address, in the deposit currency's base units. */
  private async balanceOf(deposit: Deposit): Promise<bigint | null> {
    const { chain, currency, address } = deposit

    if (isEvmNetwork(chain)) {
      if (currency === Currency.USDT) {
        const contractAddress = this.configService.get(`evmNetworks.${chain}.coinContractAddress.USDT`, { infer: true })!
        return this.ethInfoService.getERC20Balance(address, contractAddress, chain)
      }
      return this.ethInfoService.getNativeBalance(address, chain)
    }

    if (chain === Chain.TRON) {
      return currency === Currency.USDT
        ? this.tronInfoService.getTRC20BalanceBaseUnits(address, this.configService.get('tron_usdt_contract_address')!)
        : this.tronInfoService.getTRXBalanceSun(address)
    }

    if (chain === Chain.BTC) return this.btcInfoService.getBTCBalanceSatoshi(address)

    return null
  }
}
