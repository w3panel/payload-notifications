import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions, NotificationLifecycleEvent } from '../types'
import { maskDestination } from '../recipients/resolve'

/** `user:<id>` stays; `email:` / `phone:` keys are masked. */
export const maskRecipientKey = (key: string | null | undefined): string | undefined => {
  if (!key) return undefined
  const [kind, ...rest] = key.split(':')
  if (kind === 'user') return key
  return `${kind}:${maskDestination(rest.join(':')) ?? '***'}`
}

/**
 * Emits a lifecycle event to `observability.onEvent` and (with
 * `observability.log`) `payload.logger`. Never throws: observability must not
 * break sending.
 */
export const emitLifecycle = async (
  payload: Payload,
  options: Pick<NormalizedNotificationsPluginOptions, 'observability'>,
  event: Omit<NotificationLifecycleEvent, 'type' | 'at' | 'recipient'> & {
    recipient?: string | null
  },
): Promise<void> => {
  const { onEvent, log } = options.observability
  if (!onEvent && !log) return
  const full: NotificationLifecycleEvent = {
    type: 'notification.lifecycle',
    at: new Date().toISOString(),
    ...event,
    recipient: maskRecipientKey(event.recipient),
  }
  if (log) {
    const level = full.stage === 'failed' || full.stage === 'unknown' ? 'warn' : 'info'
    payload.logger?.[level]?.(
      full,
      `payload-notifications: ${full.stage} ${full.trigger ?? full.event ?? ''}`.trim(),
    )
  }
  if (!onEvent) return
  try {
    await onEvent(full)
  } catch (error) {
    payload.logger?.error?.({ err: error }, 'payload-notifications: observability.onEvent failed')
  }
}
