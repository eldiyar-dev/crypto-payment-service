import { Logger } from '@nestjs/common'

/**
 * Runs a promise without awaiting it, but guarantees its rejection is handled.
 *
 * A bare `void somePromise()` leaves a rejection unhandled, which is fatal under Node's
 * default `--unhandled-rejections=throw`. On a service that custodies funds, a debug log line
 * or a best-effort notification must never be able to take the process down mid-withdrawal.
 *
 * @param promise - The promise to run in the background
 * @param logger - Logger used to report a rejection
 * @param context - Short description of what was being attempted, for the log line
 */
export const fireAndForget = (promise: Promise<unknown>, logger: Logger, context: string): void => {
  void promise.catch((error: unknown) => {
    logger.error(`${context} failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}
