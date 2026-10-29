import type { Payload, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationClassification,
  NotificationDataContext,
  NotificationDeliveryDefinition,
  NotificationEvent,
  NotificationTrigger,
  ResolvedRecipient,
} from '../types'
import { buildDataContext } from '../data/buildContext'
import { createSensitiveFieldMatcher, type SensitiveFieldMatcher } from '../data/sensitive'
import { resolveRecipients } from '../recipients/resolve'
import { conditionNeedsData, evaluateCondition } from '../triggers/conditions'
import { applyQuietHours, computeSchedule, isValidTimeZone } from './schedule'

export type RecipientScope = {
  id?: string
  name?: string
  email?: string
  locale?: string
  timezone?: string
  aliases: string[]
}

/** One message the trigger would send: a delivery definition for one recipient. */
export type TriggerPlanItem = {
  delivery: NotificationDeliveryDefinition
  recipient: ResolvedRecipient
  recipientScope: RecipientScope
  destination?: string
  sendAt?: Date
}

export type TriggerPlan =
  /** Conditions did not match: nothing to do and nothing to log. */
  | { ok: false; outcome: 'not-matched'; reason: string }
  | { ok: false; outcome: 'skipped' | 'failed'; reason: string; warnings: string[] }
  | {
      ok: true
      context: NotificationDataContext
      /** Condition scope: the context with `event` as the full event object. */
      scope: Record<string, unknown>
      classification?: NotificationClassification
      recipients: ResolvedRecipient[]
      items: TriggerPlanItem[]
      /** Optional data sources that resolved to nothing. */
      missing: string[]
      warnings: string[]
    }

export const recipientScopeOf = (recipient: ResolvedRecipient): RecipientScope => ({
  id: recipient.recipientId,
  name: recipient.name,
  email: recipient.destinations.email,
  locale: recipient.locale,
  timezone: recipient.timezone,
  aliases: recipient.aliases,
})

/**
 * Works out what a trigger would send for an event, without writing anything:
 * conditions (before / after data), data context, recipients, schedule and
 * quiet hours, and per-recipient `when`. Used by the delivery planner and the
 * admin test runner.
 */
export const evaluateTriggerPlan = async ({
  payload,
  event,
  trigger,
  options,
  isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields),
  req,
  lookups,
  now = new Date(),
}: {
  payload: Payload
  event: NotificationEvent
  trigger: NotificationTrigger
  options: NormalizedNotificationsPluginOptions
  isSensitive?: SensitiveFieldMatcher
  /** Job request handed to resolvers. */
  req?: PayloadRequest
  /** Run collection lookups with a user's access instead of overrideAccess (test runner). */
  lookups?: { req: PayloadRequest; overrideAccess: false }
  now?: Date
}): Promise<TriggerPlan> => {
  const owner = `trigger "${trigger.slug}"`

  if (trigger.condition && !(await trigger.condition(event.payload ?? {}))) {
    return { ok: false, outcome: 'not-matched', reason: 'condition function returned false' }
  }

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
    return { ok: false, outcome: 'not-matched', reason: 'conditions did not match' }
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
    resolverReq: req,
    ...(lookups ? { req: lookups.req, overrideAccess: false } : {}),
    tenancy:
      options.tenancy && event.tenant
        ? { field: options.tenancy.field, value: event.tenant }
        : undefined,
  })
  if (!dataContext.ok) {
    return {
      ok: false,
      outcome: 'skipped',
      reason: `${dataContext.reason} (${dataContext.source}): ${dataContext.message}`,
      warnings: [],
    }
  }

  const scope: Record<string, unknown> = { ...dataContext.context, event }
  if (
    trigger.conditions &&
    conditionsNeedData &&
    !(await evaluateCondition(trigger.conditions, conditionArgs(scope)))
  ) {
    return { ok: false, outcome: 'not-matched', reason: 'conditions did not match' }
  }

  const { recipients, warnings } = await resolveRecipients({
    payload,
    event,
    context: dataContext.context,
    definitions: trigger.recipients,
    options,
    owner,
    req,
  })

  if (!recipients.length) {
    const usesEventUser = (trigger.recipients ?? [{ type: 'eventUser' }]).some(
      (definition) => definition.type === 'eventUser',
    )
    return {
      ok: false,
      outcome: 'failed',
      reason:
        !event.userId && usesEventUser
          ? 'Notification event userId is required to queue sends'
          : `No recipients resolved for ${owner}${warnings.length ? `: ${warnings.join('; ')}` : ''}`,
      warnings,
    }
  }

  const classification = trigger.classification ?? event.classification
  const schedule = computeSchedule(trigger.schedule, scope, now)
  if (!schedule.ok) {
    return { ok: false, outcome: 'skipped', reason: `schedule: ${schedule.reason}`, warnings }
  }
  if (schedule.at && schedule.at < now && trigger.schedule?.skipIfPast) {
    return {
      ok: false,
      outcome: 'skipped',
      reason: `schedule: ${schedule.at.toISOString()} has already passed`,
      warnings,
    }
  }

  const quietHours =
    options.quietHours &&
    classification &&
    options.quietHours.classifications.includes(classification)
      ? options.quietHours
      : undefined
  /** Send time for one recipient: the schedule, moved out of their quiet hours. */
  const sendTimeFor = (recipient: ResolvedRecipient): Date | undefined => {
    if (!quietHours) return schedule.at
    const base = schedule.at && schedule.at > now ? schedule.at : now
    const timeZone =
      recipient.timezone && isValidTimeZone(recipient.timezone)
        ? recipient.timezone
        : quietHours.timezone
    const adjusted = applyQuietHours(base, quietHours, timeZone)
    return adjusted > base ? adjusted : schedule.at
  }

  const items: TriggerPlanItem[] = []
  for (const delivery of trigger.deliveries) {
    // Compiled legacy rules may list channels that are not enabled; v2 triggers are validated.
    if (!options.channels.includes(delivery.channel)) continue
    const target = delivery.recipient ?? 'all'

    for (const recipient of recipients) {
      if (target !== 'all' && !recipient.aliases.includes(target)) continue
      const recipientScope = recipientScopeOf(recipient)
      if (
        delivery.when &&
        !(await evaluateCondition(
          delivery.when,
          conditionArgs({ ...scope, recipient: recipientScope }),
        ))
      ) {
        continue
      }
      items.push({
        delivery,
        recipient,
        recipientScope,
        destination:
          recipient.destinations[delivery.channel as keyof typeof recipient.destinations],
        sendAt: sendTimeFor(recipient),
      })
    }
  }

  return {
    ok: true,
    context: dataContext.context,
    scope,
    classification,
    recipients,
    items,
    missing: dataContext.missing,
    warnings,
  }
}
