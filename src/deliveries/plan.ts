import type { Payload, PayloadRequest } from 'payload'
import type {
  AdminTriggerRecord,
  EffectiveTrigger,
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  ResolvedRecipient,
} from '../types'
import { createSensitiveFieldMatcher } from '../data/sensitive'
import { generateEventId } from '../events/registry'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { writeNotificationLog } from '../jobs/writeLog'
import { maskDestination } from '../recipients/resolve'
import { evaluateTriggerPlan } from './evaluate'
import { emitLifecycle } from '../observability'
import { deliveryCategory } from '../policy/deliveryPolicy'
import { resolveRetryPolicy } from './retry'
import { createFallbackDelivery, type FallbackSource } from './fallback'
import { matchTriggers, snapshotTrigger, type TriggerSnapshot } from '../triggers/match'
import { resolveEffectiveTriggers } from '../triggers/registry'

export type PlannedDelivery = {
  deliveryId?: string
  trigger: string
  channel: string
  recipientKey: string
  status: 'queued' | 'skipped' | 'existing' | 'duplicate'
  reason?: string
}

export type DeliveryPlanResult = {
  eventId: string
  matched: TriggerSnapshot[]
  deliveries: PlannedDelivery[]
}

const isDuplicateKeyError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /duplicate|unique|already exists|E11000/i.test(message)
}

/**
 * Delivery idempotency key: one per logical business event (the caller's
 * `idempotencyKey`, else `eventId`), trigger, recipient, channel and template.
 */
export const buildDeliveryKey = ({
  event,
  trigger,
  recipient,
  channel,
  template,
}: {
  event: NotificationEvent
  trigger: string
  recipient: ResolvedRecipient
  channel: string
  template: string
}): string =>
  [event.idempotencyKey || event.eventId, trigger, recipient.key, channel, template].join('::')

const findDeliveryByKey = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  idempotencyKey: string,
): Promise<{ id: string; status?: string } | undefined> => {
  const existing = await payload.find({
    collection: options.collections.deliveries as never,
    where: { idempotencyKey: { equals: idempotencyKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const doc = existing.docs?.[0] as { id: string | number; status?: string } | undefined
  return doc ? { id: String(doc.id), status: doc.status } : undefined
}

/** Delivery fields for a resolved retry policy. */
const retryFields = (policy: ReturnType<typeof resolveRetryPolicy>) => ({
  maxAttempts: policy.maxAttempts,
  retryPolicy: { backoff: policy.backoff, jitter: policy.jitter },
})

/** Statuses that make a delivery count for dedupe (failed / skipped / cancelled ones do not). */
const DEDUPE_STATUSES = ['planned', 'queued', 'sending', 'sent', 'delivered', 'unknown']

/** An earlier delivery with the same dedupe key, recipient and channel (within the window). */
export const findDedupeMatch = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  {
    dedupeKey,
    recipientKey,
    channel,
    windowSeconds,
    now = new Date(),
  }: {
    dedupeKey: string
    recipientKey: string
    channel: string
    windowSeconds?: number
    now?: Date
  },
): Promise<string | undefined> => {
  const result = await payload.find({
    collection: options.collections.deliveries as never,
    where: {
      and: [
        { dedupeKey: { equals: dedupeKey } },
        { recipientKey: { equals: recipientKey } },
        { channel: { equals: channel } },
        { status: { in: DEDUPE_STATUSES } },
        ...(windowSeconds
          ? [
              {
                createdAt: {
                  greater_than: new Date(now.getTime() - windowSeconds * 1000).toISOString(),
                },
              },
            ]
          : []),
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const doc = result.docs?.[0] as { id: string | number } | undefined
  return doc ? String(doc.id) : undefined
}

/**
 * Plans deliveries for one event: matches code and admin triggers, resolves
 * each trigger's data context and recipients once, creates one
 * `notification-deliveries` record per recipient × delivery (upsert on the
 * idempotency key) and queues a send job per new record.
 */
export const planDeliveries = async ({
  payload,
  event: inputEvent,
  options,
  adminTriggers = [],
  req,
}: {
  payload: Payload
  event: NotificationEvent
  options: NormalizedNotificationsPluginOptions
  adminTriggers?: AdminTriggerRecord[]
  /** Job request: passed to resolvers so their writes are depth-tracked. */
  req?: PayloadRequest
}): Promise<DeliveryPlanResult> => {
  const event: NotificationEvent = {
    ...inputEvent,
    eventId: inputEvent.eventId || generateEventId(),
    occurredAt: inputEvent.occurredAt || new Date().toISOString(),
  }
  const eventId = event.eventId as string

  const registry = resolveEffectiveTriggers(options.triggers, adminTriggers)
  for (const error of registry.errors) {
    payload.logger?.warn?.(`payload-notifications: ${error}`)
  }

  const byName = matchTriggers(registry.triggers, { type: 'event', name: event.name })
  const bySource = event.source
    ? matchTriggers(registry.triggers, {
        type: 'collection',
        collection: event.source.collection,
        operation: event.source.operation,
      })
    : []
  const matched = [...bySource, ...byName.filter((entry) => !bySource.includes(entry))]
  const result: DeliveryPlanResult = {
    eventId,
    matched: matched.map(snapshotTrigger),
    deliveries: [],
  }
  const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)

  for (const entry of matched) {
    await emitLifecycle(payload, options, {
      stage: 'matched',
      event: event.name,
      eventId,
      trigger: entry.trigger.slug,
      triggerSource: entry.origin,
      triggerVersion: entry.version,
    })
    await planTrigger({ payload, event, entry, options, isSensitive, result, req })
  }

  return result
}

const planTrigger = async ({
  payload,
  event,
  entry,
  options,
  isSensitive,
  result,
  req,
}: {
  payload: Payload
  event: NotificationEvent
  entry: EffectiveTrigger
  options: NormalizedNotificationsPluginOptions
  isSensitive: ReturnType<typeof createSensitiveFieldMatcher>
  result: DeliveryPlanResult
  req?: PayloadRequest
}) => {
  const { trigger } = entry
  const snapshot = snapshotTrigger(entry)
  const first = trigger.deliveries[0]
  const logTriggerSkip = async (status: 'skipped' | 'failed', error: string) => {
    await writeNotificationLog({
      payload,
      options,
      input: {
        userId: event.userId ?? '',
        event: event.name,
        channel: first.channel,
        template: first.template,
      },
      status,
      error,
      failureClassification: 'terminal',
      meta: { eventId: event.eventId, trigger: snapshot },
    })
    await emitLifecycle(payload, options, {
      stage: 'skipped',
      event: event.name,
      eventId: event.eventId,
      trigger: trigger.slug,
      triggerSource: snapshot.origin,
      triggerVersion: snapshot.version,
      reason: error,
    })
  }

  const plan = await evaluateTriggerPlan({ payload, event, trigger, options, isSensitive, req })
  for (const warning of plan.ok || plan.outcome !== 'not-matched' ? plan.warnings : []) {
    payload.logger?.warn?.(`payload-notifications: ${warning}`)
  }
  if (!plan.ok) {
    if (plan.outcome !== 'not-matched') await logTriggerSkip(plan.outcome, plan.reason)
    return
  }

  const { classification } = plan
  const now = new Date()

  for (const { delivery, recipient, recipientScope, destination, sendAt } of plan.items) {
    const idempotencyKey = buildDeliveryKey({
      event,
      trigger: trigger.slug,
      recipient,
      channel: delivery.channel,
      template: delivery.template,
    })
    const planned: PlannedDelivery = {
      trigger: trigger.slug,
      channel: delivery.channel,
      recipientKey: recipient.key,
      status: 'queued',
    }

    const existing = await findDeliveryByKey(payload, options, idempotencyKey)
    if (existing) {
      result.deliveries.push({ ...planned, deliveryId: existing.id, status: 'existing' })
      continue
    }

    const duplicateOf = plan.dedupeKey
      ? await findDedupeMatch(payload, options, {
          dedupeKey: plan.dedupeKey,
          recipientKey: recipient.key,
          channel: delivery.channel,
          windowSeconds: trigger.dedupe?.windowSeconds,
          now,
        })
      : undefined

    const skipReason = duplicateOf
      ? `Duplicate of delivery ${duplicateOf} (dedupe key)`
      : destination
        ? undefined
        : `No ${delivery.channel} destination for recipient`
    const record = {
      event: event.name,
      eventId: event.eventId,
      trigger: trigger.slug,
      triggerOrigin: snapshot.origin,
      triggerVersion: snapshot.version,
      triggerPolicy: snapshot.policy,
      channel: delivery.channel,
      templateSlug: delivery.template,
      status: skipReason ? 'skipped' : 'queued',
      attempts: 0,
      recipientKey: recipient.key,
      recipientId: recipient.recipientId,
      recipientAlias: recipient.aliases.join(','),
      destination,
      destinationMasked: maskDestination(destination),
      classification,
      idempotencyKey,
      dedupeKey: plan.dedupeKey,
      category: deliveryCategory(trigger.category, classification),
      fallback: delivery.fallback,
      recipientDestinations: recipient.destinations,
      ...retryFields(resolveRetryPolicy(options, trigger.reliability, delivery.channel)),
      skipReason,
      scheduledFor: sendAt?.toISOString(),
      recheckConditions: trigger.schedule?.recheckConditions === true,
      context: {
        ...plan.context,
        recipient: recipientScope,
      },
      templateOverrides: delivery.templateOverrides,
    }

    let created: { id: string | number }
    try {
      created = (await payload.create({
        collection: options.collections.deliveries as never,
        data: record as never,
        overrideAccess: true,
      })) as { id: string | number }
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error
      const raced = await findDeliveryByKey(payload, options, idempotencyKey)
      if (!raced) throw error
      result.deliveries.push({ ...planned, deliveryId: raced.id, status: 'existing' })
      continue
    }
    const deliveryId = String(created.id)

    if (skipReason) {
      await writeNotificationLog({
        payload,
        options,
        input: {
          userId: recipient.recipientId ?? '',
          event: event.name,
          channel: delivery.channel,
          template: delivery.template,
          idempotencyKey,
          deliveryId,
        },
        status: 'skipped',
        error: skipReason,
        fingerprint: idempotencyKey,
        failureClassification: 'terminal',
      })
      result.deliveries.push({
        ...planned,
        deliveryId,
        status: duplicateOf ? 'duplicate' : 'skipped',
        reason: skipReason,
      })
      await emitLifecycle(payload, options, {
        stage: 'skipped',
        event: event.name,
        eventId: event.eventId,
        trigger: trigger.slug,
        triggerSource: snapshot.origin,
        triggerVersion: snapshot.version,
        deliveryId,
        channel: delivery.channel,
        recipient: recipient.key,
        reason: skipReason,
      })
      if (!duplicateOf) {
        await createFallbackDelivery({
          payload,
          options,
          primary: { ...(record as unknown as FallbackSource), id: deliveryId },
          reason: 'no-destination',
          detail: skipReason ?? 'no destination',
        })
      }
      continue
    }

    await payload.jobs.queue({
      overrideAccess: true,
      task: NOTIFICATION_SEND_TASK,
      queue: options.jobs.queue,
      input: {
        deliveryId,
        userId: recipient.recipientId ?? '',
        channel: delivery.channel,
        template: delivery.template,
        event: event.name,
        eventId: event.eventId,
        classification,
        idempotencyKey: event.idempotencyKey,
      },
      ...(sendAt && sendAt > now ? { waitUntil: sendAt } : {}),
    })
    result.deliveries.push({ ...planned, deliveryId })
    await emitLifecycle(payload, options, {
      stage: 'planned',
      event: event.name,
      eventId: event.eventId,
      trigger: trigger.slug,
      triggerSource: snapshot.origin,
      triggerVersion: snapshot.version,
      deliveryId,
      channel: delivery.channel,
      recipient: recipient.key,
    })
  }
}
