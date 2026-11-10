import type { Payload } from 'payload'
import { getRuntimeOptions } from '../config/runtime'
import { NOTIFICATIONS_JOB_QUEUE } from './constants'

export type DrainNotificationQueueResult = {
  /** Runner passes made. */
  passes: number
  /** True when the queue reported no runnable jobs left. */
  drained: boolean
  /** True when the time budget stopped the drain before the queue emptied. */
  budgetExceeded: boolean
}

/**
 * Runs the notifications queue for a short, bounded time. Call it after the
 * response is sent (`ctx.waitUntil` on Workers, `after()` / `waitUntil` on Vercel)
 * so messages go out in seconds without waiting for the next cron. Keep the cron
 * as the safety net: anything left here is picked up there.
 *
 * Each pass runs up to `limit` due jobs. A further pass only starts while jobs remain
 * (planning can queue send jobs) and the time budget has not run out.
 */
export const drainNotificationQueue = async ({
  payload,
  queue,
  limit = 10,
  maxPasses = 3,
  budgetMs = 8_000,
}: {
  payload: Payload
  /** Defaults to the installed plugin's `jobs.queue`. */
  queue?: string
  limit?: number
  maxPasses?: number
  budgetMs?: number
}): Promise<DrainNotificationQueueResult> => {
  const name = queue ?? getRuntimeOptions(payload)?.jobs.queue ?? NOTIFICATIONS_JOB_QUEUE
  const deadline = Date.now() + budgetMs
  let passes = 0
  while (passes < maxPasses) {
    if (Date.now() >= deadline) return { passes, drained: false, budgetExceeded: true }
    passes++
    const result = (await payload.jobs.run({ queue: name, limit, overrideAccess: true })) as
      | { noJobsRemaining?: boolean; remainingJobsFromQueried?: number }
      | undefined
    if (result?.noJobsRemaining) return { passes, drained: true, budgetExceeded: false }
  }
  return { passes, drained: false, budgetExceeded: false }
}
