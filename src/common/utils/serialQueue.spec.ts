import { Logger } from '@nestjs/common'
import { SerialQueue } from './serialQueue'

const silentLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('SerialQueue', () => {
  // The property that matters: withdrawals read a balance then spend it, and all draw gas from
  // one shared fee wallet. Two running at once race on that wallet's nonce and balance.
  it('never runs two tasks concurrently', async () => {
    const queue = new SerialQueue(silentLogger, 'test')
    let running = 0
    let maxConcurrent = 0

    const task = async () => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
    }

    for (let i = 0; i < 10; i++) queue.push(task)
    await queue.drain()

    expect(maxConcurrent).toBe(1)
  })

  it('preserves submission order', async () => {
    const queue = new SerialQueue(silentLogger, 'test')
    const order: number[] = []

    for (let i = 0; i < 5; i++) {
      queue.push(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        order.push(i)
      })
    }
    await queue.drain()

    expect(order).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps draining after a task throws', async () => {
    const queue = new SerialQueue(silentLogger, 'test')
    const completed: string[] = []

    queue.push(() => Promise.reject(new Error('boom')))
    queue.push(async () => {
      await Promise.resolve()
      completed.push('after')
    })
    await queue.drain()

    expect(completed).toEqual(['after'])
  })

  it('processes a task enqueued while another is in flight', async () => {
    const queue = new SerialQueue(silentLogger, 'test')
    const gate = deferred()
    const completed: string[] = []

    queue.push(async () => {
      await gate.promise
      completed.push('first')
    })

    // Enqueued mid-flight — the drain must pick it up rather than leaving it stranded.
    queue.push(async () => {
      await Promise.resolve()
      completed.push('second')
    })

    gate.resolve()
    await queue.drain()

    expect(completed).toEqual(['first', 'second'])
  })

  describe('backpressure', () => {
    it('rejects tasks beyond maxSize instead of growing without bound', () => {
      const queue = new SerialQueue(silentLogger, 'test', 2)
      const gate = deferred()

      // The first push starts running immediately, so it does not occupy a slot.
      expect(queue.push(() => gate.promise)).toBe(true)
      expect(queue.push(() => Promise.resolve())).toBe(true)
      expect(queue.push(() => Promise.resolve())).toBe(true)
      expect(queue.push(() => Promise.resolve())).toBe(false)

      gate.resolve()
    })
  })

  describe('shutdown', () => {
    it('rejects new work once closed but still drains what is queued', async () => {
      const queue = new SerialQueue(silentLogger, 'test')
      const gate = deferred()
      const completed: string[] = []

      queue.push(async () => {
        await gate.promise
        completed.push('in-flight')
      })
      queue.push(async () => {
        await Promise.resolve()
        completed.push('queued')
      })

      queue.close()
      expect(queue.push(() => Promise.resolve())).toBe(false)

      gate.resolve()
      await queue.drain()

      expect(completed).toEqual(['in-flight', 'queued'])
    })

    it('drain resolves immediately when idle', async () => {
      const queue = new SerialQueue(silentLogger, 'test')
      await expect(queue.drain()).resolves.toBeUndefined()
    })
  })
})
