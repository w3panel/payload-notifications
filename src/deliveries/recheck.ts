import type { Payload } from 'payload'
import type {
  AdminTriggerRecord,
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationTemplateContext,
} from '../types'
import { buildDataContext } from '../data/buildContext'
import { isObject, pickPaths } from '../data/paths'
import { createSensitiveFieldMatcher } from '../data/sensitive'
import { evaluateCondition } from '../triggers/conditions'
import { resolveEffectiveTriggers } from '../triggers/registry'

export type RecheckDelivery = {
  trigger: string
  channel: string
  templateSlug: string
  recipientAlias?: string | null
  context?: NotificationTemplateContext | null
}

export type RecheckResult =
  | { ok: true; context: NotificationTemplateContext }
  | { ok: false; reason: string }

/**
 * Re-validates a scheduled delivery when it is due: the trigger must still exist
 * and be enabled, collection documents are re-read, data sources reload, and
 * the trigger `conditions` and the delivery's `when` must still match. Returns
 * the fresh context (with the original `recipient`) to render from.
 */
export const recheckDelivery = async ({
  payload,
  delivery,
  options,
  adminTriggers = [],
}: {
  payload: Payload
  delivery: RecheckDelivery
  options: NormalizedNotificationsPluginOptions
  adminTriggers?: AdminTriggerRecord[]
}): Promise<RecheckResult> => {
  const entry = resolveEffectiveTriggers(options.triggers, adminTriggers).triggers.find(
    (candidate) => candidate.trigger.slug === delivery.trigger,
  )
  if (!entry) return { ok: false, reason: `trigger "${delivery.trigger}" no longer exists` }
  const { trigger } = entry
  if (trigger.enabled === false)
    return { ok: false, reason: `trigger "${trigger.slug}" is disabled` }

  const stored = (delivery.context ?? {}) as Record<string, unknown>
  const info = (isObject(stored.trigger) ? stored.trigger : {}) as Record<string, unknown>
  const event: NotificationEvent = {
    name: String(info.name ?? stored.event ?? ''),
    eventId: typeof info.eventId === 'string' ? info.eventId : undefined,
    occurredAt: typeof info.occurredAt === 'string' ? info.occurredAt : undefined,
    classification:
      info.classification === 'marketing' || info.classification === 'transactional'
        ? info.classification
        : undefined,
    tenant: typeof info.tenant === 'string' ? info.tenant : undefined,
    userId: typeof stored.userId === 'string' ? stored.userId : undefined,
    payload: isObject(stored.payload) ? stored.payload : {},
  }

  if (trigger.source.type === 'collection') {
    const storedDoc = isObject(stored.doc) ? stored.doc : undefined
    const config = options.collectionEvents[trigger.source.collection]
    if (storedDoc?.id !== undefined && config) {
      const fresh = await payload.findByID({
        collection: trigger.source.collection as never,
        id: storedDoc.id as string,
        depth: 0,
        overrideAccess: true,
        disableErrors: true,
      })
      if (!isObject(fresh)) return { ok: false, reason: 'the document no longer exists' }
      event.source = trigger.source
      event.doc = pickPaths(fresh, config.capture)
      event.previous = isObject(stored.previous) ? stored.previous : null
    }
  }

  if (trigger.condition && !(await trigger.condition(event.payload ?? {}))) {
    return { ok: false, reason: 'trigger condition no longer matches' }
  }

  const data = await buildDataContext({
    payload,
    event,
    doc: event.doc ?? undefined,
    previous: event.previous ?? undefined,
    sources: trigger.data?.sources,
    dataResolvers: options.dataResolvers,
    computed: options.computed,
    isSensitive: createSensitiveFieldMatcher(options.data.sensitiveFields),
    owner: `trigger "${trigger.slug}"`,
    tenancy:
      options.tenancy && event.tenant
        ? { field: options.tenancy.field, value: event.tenant }
        : undefined,
  })
  if (!data.ok) return { ok: false, reason: `${data.reason} (${data.source}): ${data.message}` }

  const recipient = isObject(stored.recipient) ? stored.recipient : undefined
  const scope: Record<string, unknown> = { ...data.context, event, recipient }
  const conditionArgs = {
    scope,
    event,
    payload,
    custom: options.conditions,
    documentAliases: (trigger.data?.sources ?? [])
      .filter((source) => source.type === 'document')
      .map((source) => source.alias),
  }

  if (!(await evaluateCondition(trigger.conditions, conditionArgs))) {
    return { ok: false, reason: 'trigger conditions no longer match' }
  }

  const aliases = (delivery.recipientAlias ?? '').split(',').filter(Boolean)
  const definition = trigger.deliveries.find(
    (candidate) =>
      candidate.channel === delivery.channel &&
      candidate.template === delivery.templateSlug &&
      (!candidate.recipient ||
        candidate.recipient === 'all' ||
        aliases.includes(candidate.recipient)),
  )
  if (!definition) return { ok: false, reason: 'the delivery was removed from the trigger' }
  if (!(await evaluateCondition(definition.when, conditionArgs))) {
    return { ok: false, reason: 'delivery condition (when) no longer matches' }
  }

  return { ok: true, context: { ...data.context, ...(recipient ? { recipient } : {}) } }
}
