import type { Payload, PayloadRequest } from 'payload'
import type {
  AdminTriggerRecord,
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationRule,
} from '../types'
import { getRuntimeOptions } from '../config/runtime'
import { planDeliveries, type DeliveryPlanResult } from '../deliveries/plan'
import { DEFAULT_MAX_EVENT_DEPTH, getEventDepth } from '../events/depth'
import { recordInboxEvent, trackInboxProcessing } from '../events/inbox'
import { prepareNotificationEvent } from '../events/registry'
import { NOTIFICATION_PROCESS_EVENT_TASK, NOTIFICATIONS_JOB_QUEUE } from './constants'

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
    ...(isCollectionSource(value.source) ? { source: value.source } : {}),
    ...(typeof value.tenant === 'string' && value.tenant ? { tenant: value.tenant } : {}),
    ...(typeof value.depth === 'number' && value.depth >= 0 ? { depth: value.depth } : {}),
    ...(value.doc !== undefined ? { doc: isObject(value.doc) ? value.doc : null } : {}),
    ...(value.previous !== undefined
      ? { previous: isObject(value.previous) ? value.previous : null }
      : {}),
  }
}

const isCollectionSource = (value: unknown): value is NonNullable<NotificationEvent['source']> =>
  isObject(value) &&
  value.type === 'collection' &&
  typeof value.collection === 'string' &&
  (value.operation === 'create' || value.operation === 'update' || value.operation === 'delete')

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
  req,
}: {
  payload: Payload
  event: NotificationEvent
  queue?: string
  /** Defaults to the options of the installed plugin. */
  options?: NormalizedNotificationsPluginOptions
  /**
   * Request to queue the job with. Inside a hook or transaction, pass `req` so the
   * job is only created if the surrounding write commits.
   */
  req?: PayloadRequest
}): Promise<NotificationEvent> => {
  const validatedEvent = assertNotificationEvent(event)
  const pluginOptions = options ?? getRuntimeOptions(payload)
  const depth = validatedEvent.depth ?? getEventDepth(req)
  const maxDepth = pluginOptions?.maxEventDepth ?? DEFAULT_MAX_EVENT_DEPTH
  if (depth >= maxDepth) {
    throw new Error(
      `payload-notifications: event "${validatedEvent.name}" exceeds maxEventDepth (${maxDepth}); a notification workflow is probably triggering itself`,
    )
  }
  const preparedEvent = await prepareNotificationEvent(
    { ...validatedEvent, ...(depth ? { depth } : {}) },
    pluginOptions,
  )

  // With the inbox enabled, an eventId that was already received is not queued again.
  if (
    pluginOptions?.eventsInbox &&
    !(await recordInboxEvent({ payload, options: pluginOptions, event: preparedEvent, req }))
  ) {
    return preparedEvent
  }

  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_PROCESS_EVENT_TASK,
    queue: queue ?? pluginOptions?.jobs.queue ?? NOTIFICATIONS_JOB_QUEUE,
    input: preparedEvent,
    ...(req ? { req } : {}),
  })

  return preparedEvent
}

/**
 * Plans deliveries for an event: matches code (and published admin) triggers,
 * resolves data and recipients, creates `notification-deliveries` records and
 * queues one send job per delivery.
 */
export const processEvent = async ({
  payload,
  event,
  options,
  adminTriggers,
  req,
}: {
  payload: Payload
  event: NotificationEvent
  options: NormalizedNotificationsPluginOptions
  /** Published admin-created triggers (Phase 4); defaults to none. */
  adminTriggers?: AdminTriggerRecord[]
  /** Job request: passed to resolvers so their writes are depth-tracked. */
  req?: PayloadRequest
}): Promise<DeliveryPlanResult> => {
  const validatedEvent = assertNotificationEvent(event)
  const plan = () => planDeliveries({ payload, event: validatedEvent, options, adminTriggers, req })
  return options.eventsInbox ? trackInboxProcessing(payload, options, validatedEvent, plan) : plan()
}
