import type { Payload } from 'payload'
import type {
  AdminTriggerRecord,
  EffectiveTrigger,
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  ResolvedRecipient,
} from '../types'
import { buildDataContext } from '../data/buildContext'
import { createSensitiveFieldMatcher } from '../data/sensitive'
import { generateEventId } from '../events/registry'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { writeNotificationLog } from '../jobs/writeLog'
import { maskDestination, resolveRecipients } from '../recipients/resolve'
import { conditionNeedsData, evaluateCondition } from '../triggers/conditions'
import { matchTriggers, snapshotTrigger, type TriggerSnapshot } from '../triggers/match'
import { resolveEffectiveTriggers } from '../triggers/registry'

export type PlannedDelivery = {
  deliveryId?: string
  trigger: string
  channel: string
  recipientKey: string
  status: 'queued' | 'skipped' | 'existing'
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
}: {
  payload: Payload
  event: NotificationEvent
  options: NormalizedNotificationsPluginOptions
  adminTriggers?: AdminTriggerRecord[]
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

  const matched = matchTriggers(registry.triggers, { type: 'event', name: event.name })
  const result: DeliveryPlanResult = {
    eventId,
    matched: matched.map(snapshotTrigger),
    deliveries: [],
  }
  const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)

  for (const entry of matched) {
    await planTrigger({ payload, event, entry, options, isSensitive, result })
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
}: {
  payload: Payload
  event: NotificationEvent
  entry: EffectiveTrigger
  options: NormalizedNotificationsPluginOptions
  isSensitive: ReturnType<typeof createSensitiveFieldMatcher>
  result: DeliveryPlanResult
}) => {
  const { trigger } = entry
  const snapshot = snapshotTrigger(entry)
  const owner = `trigger "${trigger.slug}"`
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
  }

  if (trigger.condition && !(await trigger.condition(event.payload ?? {}))) return

  const documentAliases = (trigger.data?.sources ?? [])
    .filter((source) => source.type === 'document')
    .map((source) => source.alias)
  const conditionArgs = (scope: Record<string, unknown>) => ({
    scope,
    event,
    payload,
    custom: options.conditions,
    documentAliases,
  })

  // Conditions that only read event / doc fields run before any data is loaded.
  const conditionsNeedData = conditionNeedsData(trigger.conditions)
  if (
    trigger.conditions &&
    !conditionsNeedData &&
    !(await evaluateCondition(
      trigger.conditions,
      conditionArgs({
        event,
        payload: event.payload ?? {},
        doc: event.doc,
        previous: event.previous,
        trigger: { name: event.name, eventId: event.eventId },
      }),
    ))
  ) {
    return
  }

  const dataContext = await buildDataContext({
    payload,
    event,
    doc: event.doc ?? undefined,
    previous: event.previous ?? undefined,
    sources: trigger.data?.sources,
    dataResolvers: options.dataResolvers,
    computed: options.computed,
    isSensitive,
    owner,
  })
  if (!dataContext.ok) {
    await logTriggerSkip(
      'skipped',
      `${dataContext.reason} (${dataContext.source}): ${dataContext.message}`,
    )
    return
  }

  /** Condition scope: the template context with `event` as the full event object. */
  const scope: Record<string, unknown> = { ...dataContext.context, event }
  if (
    trigger.conditions &&
    conditionsNeedData &&
    !(await evaluateCondition(trigger.conditions, conditionArgs(scope)))
  ) {
    return
  }

  const { recipients, warnings } = await resolveRecipients({
    payload,
    event,
    context: dataContext.context,
    definitions: trigger.recipients,
    options,
    owner,
  })
  for (const warning of warnings) payload.logger?.warn?.(`payload-notifications: ${warning}`)

  if (!recipients.length) {
    const usesEventUser = (trigger.recipients ?? [{ type: 'eventUser' }]).some(
      (definition) => definition.type === 'eventUser',
    )
    await logTriggerSkip(
      'failed',
      !event.userId && usesEventUser
        ? 'Notification event userId is required to queue sends'
        : `No recipients resolved for ${owner}${warnings.length ? `: ${warnings.join('; ')}` : ''}`,
    )
    return
  }

  const classification = trigger.classification ?? event.classification

  for (const delivery of trigger.deliveries) {
    // Compiled legacy rules may list channels that are not enabled; v2 triggers are validated.
    if (!options.channels.includes(delivery.channel)) continue
    const target = delivery.recipient ?? 'all'

    for (const recipient of recipients) {
      if (target !== 'all' && !recipient.aliases.includes(target)) continue

      const recipientScope = {
        id: recipient.recipientId,
        name: recipient.name,
        email: recipient.destinations.email,
        locale: recipient.locale,
        timezone: recipient.timezone,
        aliases: recipient.aliases,
      }
      if (
        delivery.when &&
        !(await evaluateCondition(
          delivery.when,
          conditionArgs({ ...scope, recipient: recipientScope }),
        ))
      ) {
        continue
      }

      const idempotencyKey = buildDeliveryKey({
        event,
        trigger: trigger.slug,
        recipient,
        channel: delivery.channel,
        template: delivery.template,
      })
      const destination =
        recipient.destinations[delivery.channel as keyof typeof recipient.destinations]
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

      const skipReason = destination
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
        skipReason,
        context: {
          ...dataContext.context,
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
        result.deliveries.push({ ...planned, deliveryId, status: 'skipped', reason: skipReason })
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
      })
      result.deliveries.push({ ...planned, deliveryId })
    }
  }
}
