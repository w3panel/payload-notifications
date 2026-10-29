import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationRetryPolicy,
  NotificationTriggerReliability,
} from '../types'

export type ResolvedRetryPolicy = {
  maxAttempts: number
  backoff: { type: 'exponential' | 'fixed'; delayMs: number; maxDelayMs: number }
  jitter: boolean
}

/** Plugin defaults ← trigger policy ← trigger per-channel policy, capped at `reliability.maxAttempts`. */
export const resolveRetryPolicy = (
  options: NormalizedNotificationsPluginOptions,
  reliability: NotificationTriggerReliability | undefined,
  channel: NotificationChannel,
): ResolvedRetryPolicy => {
  const defaults = options.reliability
  const layers: Array<NotificationRetryPolicy | undefined> = [
    reliability,
    reliability?.channels?.[channel],
  ]
  let attempts = defaults.attempts
  let backoff = { ...defaults.backoff }
  let jitter = defaults.jitter
  for (const layer of layers) {
    if (!layer) continue
    if (layer.attempts !== undefined) attempts = layer.attempts
    if (layer.backoff) backoff = { ...backoff, ...layer.backoff }
    if (layer.jitter !== undefined) jitter = layer.jitter
  }
  return { maxAttempts: Math.min(Math.max(1, attempts), defaults.maxAttempts), backoff, jitter }
}

/** Delay before attempt `nextAttempt` (2 = first retry). */
export const retryDelayMs = (
  policy: Pick<ResolvedRetryPolicy, 'backoff' | 'jitter'>,
  nextAttempt: number,
  random: () => number = Math.random,
): number => {
  const { type, delayMs, maxDelayMs } = policy.backoff
  const base =
    type === 'fixed' ? delayMs : Math.min(delayMs * 2 ** Math.max(0, nextAttempt - 2), maxDelayMs)
  return Math.round(policy.jitter ? base * (0.5 + random() / 2) : base)
}

/** Startup check for a trigger's reliability settings. */
export const validateReliability = (
  reliability: NotificationTriggerReliability | undefined,
  maxAttempts: number,
  owner: string,
): string[] => {
  if (reliability === undefined) return []
  const errors: string[] = []
  const check = (policy: NotificationRetryPolicy | undefined, label: string) => {
    if (!policy) return
    if (
      policy.attempts !== undefined &&
      (!Number.isInteger(policy.attempts) || policy.attempts < 1 || policy.attempts > maxAttempts)
    ) {
      errors.push(
        `${owner} ${label}: attempts must be between 1 and ${maxAttempts} (reliability.maxAttempts)`,
      )
    }
    const backoff = policy.backoff
    if (backoff) {
      if (
        backoff.type !== undefined &&
        backoff.type !== 'exponential' &&
        backoff.type !== 'fixed'
      ) {
        errors.push(`${owner} ${label}: backoff.type must be exponential or fixed`)
      }
      for (const key of ['delayMs', 'maxDelayMs'] as const) {
        const value = backoff[key]
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          errors.push(`${owner} ${label}: backoff.${key} must be a non-negative integer`)
        }
      }
    }
  }
  check(reliability, 'reliability')
  for (const [channel, policy] of Object.entries(reliability.channels ?? {})) {
    check(policy, `reliability.channels.${channel}`)
  }
  return errors
}

export const normalizeReliabilityOptions = (
  reliability: NotificationRetryPolicy & {
    maxAttempts?: number
    staleSendingMinutes?: number
  } = {},
): NormalizedNotificationsPluginOptions['reliability'] => {
  const maxAttempts = reliability.maxAttempts ?? 10
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50) {
    throw new Error('payload-notifications: reliability.maxAttempts must be between 1 and 50')
  }
  const errors = validateReliability(reliability, maxAttempts, 'payload-notifications:').map(
    (error) =>
      error.replace('payload-notifications: reliability', 'payload-notifications: reliability'),
  )
  if (errors.length) throw new Error(errors[0])
  const staleSendingMinutes = reliability.staleSendingMinutes ?? 30
  if (!Number.isInteger(staleSendingMinutes) || staleSendingMinutes < 1) {
    throw new Error(
      'payload-notifications: reliability.staleSendingMinutes must be a positive integer',
    )
  }
  return {
    attempts: reliability.attempts ?? 3,
    backoff: {
      type: reliability.backoff?.type ?? 'exponential',
      delayMs: reliability.backoff?.delayMs ?? 5000,
      maxDelayMs: reliability.backoff?.maxDelayMs ?? 3_600_000,
    },
    jitter: reliability.jitter ?? true,
    maxAttempts,
    staleSendingMinutes,
  }
}
