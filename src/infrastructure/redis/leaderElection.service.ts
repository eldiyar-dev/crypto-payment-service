import { TConfiguration } from '@/infrastructure/config/configuration'
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { RedisRepository } from './repository/redis.repository'

const LEADER_KEY = 'monitor:leader'

/**
 * Advisory single-writer lease for the chain monitors.
 *
 * Each instance runs its own monitors and its own in-memory queue; there is no shared broker.
 * Raising `instances` in ecosystem.config.js — the natural response to load — therefore makes
 * every instance detect and scan the same blocks. The deposit ledger's atomic claim already
 * prevents that from producing a *second withdrawal*, so this is defence in depth and a
 * scan-cost optimisation rather than the sole protection.
 *
 * The lease is a `SET NX PX` key renewed on a timer. If Redis blips and two instances briefly
 * both consider themselves leader, the ledger still collapses the duplicate work — so the
 * failure mode is wasted RPC calls, not duplicated money movement.
 *
 * Disabled unless MONITOR_LEADER_ELECTION=true, so existing single-instance deployments are
 * unaffected.
 */
@Injectable()
export class LeaderElectionService implements OnApplicationShutdown {
  private readonly logger = new Logger(LeaderElectionService.name)

  private readonly instanceId = randomUUID()
  private readonly leaseMs = 30_000
  private readonly renewMs = 10_000

  private renewTimer: NodeJS.Timeout | null = null
  private isLeader = false

  constructor(
    private readonly redisRepository: RedisRepository,
    private readonly configService: ConfigService<TConfiguration>,
  ) {}

  private get enabled(): boolean {
    return this.configService.get<TConfiguration['monitor_leader_election']>('monitor_leader_election') ?? false
  }

  /**
   * @returns True if this instance may run the chain monitors.
   */
  async acquire(): Promise<boolean> {
    if (!this.enabled) {
      this.logger.log('Leader election disabled; this instance will run the monitors. Keep PM2 instances at 1.')
      return true
    }

    this.isLeader = await this.tryAcquire()
    if (!this.isLeader) {
      this.logger.warn('Another instance holds the monitor lease; monitors will not start here')
      return false
    }

    this.logger.log(`Acquired monitor lease as ${this.instanceId}`)
    this.renewTimer = setInterval(() => void this.renew(), this.renewMs)
    return true
  }

  private async tryAcquire(): Promise<boolean> {
    return this.redisRepository.setIfAbsent(LEADER_KEY, this.instanceId, this.leaseMs)
  }

  /**
   * Extends the lease, but only while this instance still owns it — otherwise a partitioned
   * instance could steal the lease back from the current leader.
   */
  private async renew(): Promise<void> {
    try {
      const holder = await this.redisRepository.get(LEADER_KEY)
      if (holder !== this.instanceId) {
        this.logger.error('Lost the monitor lease — this instance is no longer the leader and should be restarted')
        this.isLeader = false
        this.stopRenewing()
        return
      }

      await this.redisRepository.pexpire(LEADER_KEY, this.leaseMs)
    } catch (error) {
      this.logger.error(`Failed to renew monitor lease: ${(error as Error).message}`)
    }
  }

  private stopRenewing(): void {
    if (!this.renewTimer) return

    clearInterval(this.renewTimer)
    this.renewTimer = null
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopRenewing()
    if (!this.isLeader) return

    // Release only our own lease, so a shutdown cannot delete a lease another instance has
    // since taken over.
    try {
      const holder = await this.redisRepository.get(LEADER_KEY)
      if (holder === this.instanceId) await this.redisRepository.delete(LEADER_KEY)
    } catch (error) {
      this.logger.warn(`Failed to release monitor lease: ${(error as Error).message}`)
    }
  }
}
