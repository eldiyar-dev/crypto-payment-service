import { Logger } from '@nestjs/common'

/**
 * An in-process queue that runs tasks strictly one at a time.
 *
 * Withdrawals must not run concurrently: they read a wallet's balance and then spend it, and
 * they all draw gas/energy from the same shared fee wallet, so parallel sweeps race on that
 * wallet's nonce and balance. ETH had a queue like this inline; TRON and BTC invoked the
 * withdrawal directly with `void`, starting every deposit in a block at once.
 *
 * Bounded on purpose: an unbounded queue grows without limit behind a stalled client API or a
 * burst of deposits until the process runs out of memory. Rejecting a task is recoverable —
 * the deposit stays on-chain and the scan checkpoint has not advanced past it, so it is
 * re-detected — whereas an OOM kill mid-withdrawal is not.
 */
export class SerialQueue {
  private readonly tasks: Array<() => Promise<void>> = []
  private running: Promise<void> | null = null
  private closed = false

  constructor(
    private readonly logger: Logger,
    private readonly name: string,
    private readonly maxSize = 1_000,
  ) {}

  get size(): number {
    return this.tasks.length
  }

  /**
   * Enqueues a task and ensures a drain is in progress.
   *
   * @returns False if the task was rejected because the queue is closed or full.
   */
  push(task: () => Promise<void>): boolean {
    if (this.closed) {
      this.logger.warn(`${this.name} queue is closed; task rejected`)
      return false
    }

    if (this.tasks.length >= this.maxSize) {
      this.logger.error(`${this.name} queue is full (${this.maxSize}); task rejected — it will be picked up on the next scan`)
      return false
    }

    this.tasks.push(task)
    this.schedule()
    return true
  }

  private schedule(): void {
    if (this.running) return

    this.running = this.processAll().finally(() => {
      this.running = null

      // A task enqueued while the last one was finishing would otherwise sit unprocessed.
      if (this.tasks.length) this.schedule()
    })
    void this.running
  }

  private async processAll(): Promise<void> {
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()
      if (!task) continue

      try {
        await task()
      } catch (error) {
        // One bad deposit must not abort the drain or take the process down.
        this.logger.error(`Error processing ${this.name} queue task: ${(error as Error).message}`)
      }
    }
  }

  /** Stops accepting new tasks. In-flight and queued work still drains. */
  close(): void {
    this.closed = true
  }

  /** Resolves once the in-flight drain completes. Used on graceful shutdown. */
  async drain(): Promise<void> {
    while (this.running) await this.running
  }
}
