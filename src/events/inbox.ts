import type { Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions, NotificationEvent } from '../types'
import type { DeliveryPlanResult } from '../deliveries/plan'
import { NOTIFICATION_PROCESS_EVENT_TASK } from '../jobs/constants'

type InboxRecord = { id: string | number; status?: string; attempts?: number; event?: unknown }

const isDuplicateKeyError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /duplicate|unique|already exists|E11000/i.test(message)
}

export const findInboxRecord = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  eventId: string,
): Promise<InboxRecord | undefined> => {
  const result = await payload.find({
    collection: options.collections.events as never,
    where: { eventId: { equals: eventId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  return result.docs?.[0] as InboxRecord | undefined
}

/**
 * Stores an emitted event in the inbox (with `req`, so it commits with the
 * surrounding transaction). Returns false when the eventId was already received.
 */
export const recordInboxEvent = async ({
  payload,
  options,
  event,
  req,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  event: NotificationEvent
  req?: PayloadRequest
}): Promise<boolean> => {
  try {
    await payload.create({
      collection: options.collections.events as never,
      overrideAccess: true,
      ...(req ? { req } : {}),
      data: {
        eventId: event.eventId,
        name: event.name,
        sourceType: event.source ? 'collection' : 'application',
        userId: event.userId,
        tenant: event.tenant,
        classification: event.classification,
        idempotencyKey: event.idempotencyKey,
        depth: event.depth ?? 0,
        occurredAt: event.occurredAt,
        status: 'received',
        attempts: 0,
        event,
      } as never,
    })
    return true
  } catch (error) {
    if (isDuplicateKeyError(error)) return false
    throw error
  }
}

const update = (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  id: string | number,
  data: Record<string, unknown>,
) =>
  payload.update({
    collection: options.collections.events as never,
    id,
    data: data as never,
    overrideAccess: true,
  })

/** Runs `process` while tracking processing / processed / failed on the inbox record. */
export const trackInboxProcessing = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  event: NotificationEvent,
  process: () => Promise<DeliveryPlanResult>,
): Promise<DeliveryPlanResult> => {
  const record = event.eventId ? await findInboxRecord(payload, options, event.eventId) : undefined
  if (!record) return process()

  await update(payload, options, record.id, {
    status: 'processing',
    attempts: (record.attempts ?? 0) + 1,
  })
  try {
    const result = await process()
    await update(payload, options, record.id, {
      status: 'processed',
      matched: result.matched,
      deliveries: result.deliveries.filter((delivery) => delivery.status !== 'existing').length,
      error: null,
      processedAt: new Date().toISOString(),
    })
    return result
  } catch (error) {
    await update(payload, options, record.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Re-queues a stored event for processing. Existing deliveries are reused (their
 * idempotency keys match), so only deliveries that are new — e.g. from a trigger
 * enabled since — are created.
 */
export const replayNotificationEvent = async ({
  payload,
  options,
  eventId,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  eventId: string
}): Promise<NotificationEvent> => {
  if (!options.eventsInbox) {
    throw new Error('payload-notifications: replay requires eventsInbox: true')
  }
  const record = await findInboxRecord(payload, options, eventId)
  if (!record) throw new Error(`payload-notifications: event "${eventId}" is not in the inbox`)
  const event = record.event as NotificationEvent | undefined
  if (!event?.name)
    throw new Error(`payload-notifications: event "${eventId}" has no stored payload`)

  await update(payload, options, record.id, { status: 'received', error: null })
  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_PROCESS_EVENT_TASK,
    queue: options.jobs.queue,
    input: event as never,
  })
  return event
}
