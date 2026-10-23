import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationRule,
} from '../types'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const resolveRulesForEvent = (
  eventName: string,
  rules: NotificationRule[] = [],
): NotificationRule[] => {
  return rules.filter((rule) => rule.event === eventName && rule.enabled !== false)
}

export const assertNotificationEvent = (value: unknown): NotificationEvent => {
  if (!isObject(value)) {
    throw new Error('payload-notifications: notification event input must be an object')
  }

  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('payload-notifications: notification event requires a non-empty name')
  }

  if (value.userId !== undefined && typeof value.userId !== 'string') {
    throw new Error('payload-notifications: notification event userId must be a string')
  }

  if (value.payload !== undefined && !isObject(value.payload)) {
    throw new Error('payload-notifications: notification event payload must be an object')
  }

  return {
    name: value.name,
    userId: value.userId,
    payload: value.payload,
    classification:
      value.classification === 'marketing' || value.classification === 'transactional'
        ? value.classification
        : undefined,
    idempotencyKey: typeof value.idempotencyKey === 'string' ? value.idempotencyKey : undefined,
  }
}

export const emitNotificationEvent = async ({
  payload,
  event,
}: {
  payload: Payload
  event: NotificationEvent
}) => {
  const validatedEvent = assertNotificationEvent(event)

  await payload.jobs.queue({
    overrideAccess: true,
    task: 'notification:process-event',
    input: validatedEvent,
  })
}

export const processEvent = async ({
  payload,
  event,
  options,
}: {
  payload: Payload
  event: NotificationEvent
  options: NormalizedNotificationsPluginOptions
}) => {
  const validatedEvent = assertNotificationEvent(event)
  const rules = resolveRulesForEvent(validatedEvent.name, options.rules)

  for (const rule of rules) {
    const shouldRun = rule.condition ? await rule.condition(validatedEvent.payload ?? {}) : true
    if (!shouldRun) continue

    if (!validatedEvent.userId) {
      await payload.create({
        overrideAccess: true,
        collection: options.collections.logs,
        data: {
          event: validatedEvent.name,
          channel: 'inapp',
          status: 'failed',
          template: rule.template,
          error: 'Notification event userId is required to queue sends',
        },
      })
      continue
    }

    for (const channel of rule.channels) {
      if (options.channels.length && !options.channels.includes(channel)) continue

      await payload.jobs.queue({
        overrideAccess: true,
        task: 'notification:send',
        input: {
          userId: validatedEvent.userId,
          channel,
          template: rule.template,
          event: validatedEvent.name,
          eventPayload: validatedEvent.payload,
          idempotencyKey: validatedEvent.idempotencyKey,
        },
      })
    }
  }
}
