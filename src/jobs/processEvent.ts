import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationRule,
} from '../types'
import { getRuntimeOptions } from '../config/runtime'
import { prepareNotificationEvent } from '../events/registry'
import {
  NOTIFICATION_PROCESS_EVENT_TASK,
  NOTIFICATION_SEND_TASK,
  NOTIFICATIONS_JOB_QUEUE,
} from './constants'
import { writeNotificationLog } from './writeLog'

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

  if (value.eventId !== undefined && typeof value.eventId !== 'string') {
    throw new Error('payload-notifications: notification event eventId must be a string')
  }

  if (value.occurredAt !== undefined && typeof value.occurredAt !== 'string') {
    throw new Error('payload-notifications: notification event occurredAt must be an ISO string')
  }

  return {
    name: value.name,
    eventId: value.eventId || undefined,
    occurredAt: value.occurredAt || undefined,
    userId: value.userId,
    payload: value.payload,
    classification:
      value.classification === 'marketing' || value.classification === 'transactional'
        ? value.classification
        : undefined,
    idempotencyKey: typeof value.idempotencyKey === 'string' ? value.idempotencyKey : undefined,
  }
}

/**
 * Validates an event against the registry and queues it for processing.
 * Emit only after the business action is confirmed, from trusted server code.
 *
 * Returns the prepared event (with `eventId` / `occurredAt` filled in).
 */
export const emitNotificationEvent = async ({
  payload,
  event,
  queue,
  options,
}: {
  payload: Payload
  event: NotificationEvent
  queue?: string
  /** Defaults to the options of the installed plugin. */
  options?: NormalizedNotificationsPluginOptions
}): Promise<NotificationEvent> => {
  const validatedEvent = assertNotificationEvent(event)
  const pluginOptions = options ?? getRuntimeOptions(payload)
  const preparedEvent = await prepareNotificationEvent(validatedEvent, pluginOptions)

  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_PROCESS_EVENT_TASK,
    queue: queue ?? pluginOptions?.jobs.queue ?? NOTIFICATIONS_JOB_QUEUE,
    input: preparedEvent,
  })

  return preparedEvent
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
  const queue = options.jobs.queue

  for (const rule of rules) {
    const shouldRun = rule.condition ? await rule.condition(validatedEvent.payload ?? {}) : true
    if (!shouldRun) continue

    if (!validatedEvent.userId) {
      await writeNotificationLog({
        payload,
        options,
        input: {
          userId: '',
          event: validatedEvent.name,
          channel: 'inapp',
          template: rule.template,
        },
        status: 'failed',
        error: 'Notification event userId is required to queue sends',
        failureClassification: 'terminal',
      })
      continue
    }

    for (const channel of rule.channels) {
      if (options.channels.length && !options.channels.includes(channel)) continue

      await payload.jobs.queue({
        overrideAccess: true,
        task: NOTIFICATION_SEND_TASK,
        queue,
        input: {
          userId: validatedEvent.userId,
          channel,
          template: rule.template,
          event: validatedEvent.name,
          eventPayload: validatedEvent.payload,
          classification: validatedEvent.classification,
          idempotencyKey: validatedEvent.idempotencyKey,
          templateOverrides: rule.templateOverrides?.[channel],
        },
      })
    }
  }
}
