import type { NormalizedNotificationsPluginOptions, NotificationTrigger } from '../types'
import { DEFAULT_RECIPIENTS, recipientAlias } from '../recipients/resolve'
import { validateRecipientDefinitions } from '../recipients/validate'
import { collectFieldPaths } from '../events/registry'
import { validateReliability } from '../deliveries/retry'
import { parseDuration } from '../deliveries/schedule'
import { compile as compileTemplate } from '../templates/engine'
import { validateCondition, type ConditionValidationContext } from './conditions'

export type TriggerValidationResult = {
  errors: string[]
  /** Problems that may resolve at runtime (e.g. a DB template providing a missing channel). */
  warnings: string[]
}

/**
 * Option-aware checks for a trigger's recipients and deliveries: recipient
 * definitions, delivery → recipient aliases, enabled channels, in-app
 * deliveries to static recipients, duplicates and registry template variants.
 */
export const validateTrigger = (
  trigger: NotificationTrigger,
  options: Pick<
    NormalizedNotificationsPluginOptions,
    | 'channels'
    | 'templates'
    | 'recipientResolvers'
    | 'recipientQueries'
    | 'recipients'
    | 'events'
    | 'conditions'
    | 'dataResolvers'
    | 'collectionEvents'
    | 'reliability'
  >,
  owner = `trigger "${trigger.slug}"`,
): TriggerValidationResult => {
  const definitions = trigger.recipients ?? DEFAULT_RECIPIENTS
  const errors = validateRecipientDefinitions(definitions, options, owner)
  const warnings: string[] = []

  const aliases = new Map(
    definitions.map((definition, index) => [recipientAlias(definition, index), definition]),
  )

  if (trigger.source.type === 'collection') {
    const { collection, operation } = trigger.source
    const config = options.collectionEvents[collection]
    if (!config) {
      errors.push(`${owner}: collection "${collection}" is not configured in collectionEvents`)
    } else {
      if (!config.operations.includes(operation)) {
        errors.push(`${owner}: collectionEvents["${collection}"] does not emit ${operation} events`)
      }
      for (const source of trigger.data?.sources ?? []) {
        if (source.type !== 'document') continue
        for (const field of source.fields ?? []) {
          if (field !== 'id' && !config.capture.includes(field.split('.')[0])) {
            errors.push(
              `${owner} source "${source.alias}": field "${field}" is not captured for "${collection}"`,
            )
          }
        }
      }
    }
  } else if (trigger.data?.sources?.some((source) => source.type === 'document')) {
    errors.push(`${owner}: document sources need a collection event source`)
  }

  const conditionContext = conditionContextFor(trigger, options, owner)
  errors.push(...validateSchedule(trigger, conditionContext))
  errors.push(...validateDedupe(trigger, conditionContext.owner))
  errors.push(...validateReliability(trigger.reliability, options.reliability.maxAttempts, owner))
  const collect = (result: { errors: string[]; warnings: string[] }) => {
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }
  collect(validateCondition(trigger.conditions, conditionContext))
  const seen = new Set<string>()

  trigger.deliveries.forEach((delivery, index) => {
    const label = `${owner} deliveries[${index}]`
    const target = delivery.recipient ?? 'all'

    if (target !== 'all' && !aliases.has(target)) {
      errors.push(`${label}: recipient "${target}" is not defined in recipients`)
    }
    if (!options.channels.includes(delivery.channel)) {
      errors.push(`${label}: channel "${delivery.channel}" is not enabled in plugin channels`)
    }
    if (
      delivery.channel === 'inapp' &&
      target !== 'all' &&
      aliases.get(target)?.type === 'static'
    ) {
      errors.push(`${label}: static recipient "${target}" has no in-app destination`)
    }

    if (delivery.when !== undefined) {
      collect(
        validateCondition(delivery.when, {
          ...conditionContext,
          owner: `${label}.when`,
          extraRoots: ['recipient'],
        }),
      )
    }

    if (delivery.fallback !== undefined) {
      const fallback = delivery.fallback
      if (!fallback || typeof fallback.channel !== 'string') {
        errors.push(`${label}.fallback: channel is required`)
      } else {
        if (!options.channels.includes(fallback.channel)) {
          errors.push(
            `${label}.fallback: channel "${fallback.channel}" is not enabled in plugin channels`,
          )
        }
        if (fallback.channel === delivery.channel) {
          errors.push(`${label}.fallback: must use a different channel than the delivery`)
        }
        const invalid = (fallback.on ?? []).filter(
          (reason) => !['permanent', 'no-destination', 'policy'].includes(reason),
        )
        if (invalid.length) {
          errors.push(`${label}.fallback: on must list permanent, no-destination and/or policy`)
        }
        if (
          fallback.channel === 'inapp' &&
          target !== 'all' &&
          aliases.get(target)?.type === 'static'
        ) {
          errors.push(`${label}.fallback: static recipient "${target}" has no in-app destination`)
        }
      }
    }

    const key = `${delivery.channel}::${delivery.template}::${target}`
    if (seen.has(key)) errors.push(`${label}: duplicate delivery (${delivery.channel} → ${target})`)
    seen.add(key)

    const registered = options.templates.registry[delivery.template]
    if (registered && !registered[delivery.channel]) {
      warnings.push(
        `${label}: template "${delivery.template}" has no ${delivery.channel} variant in the code registry; an active notification-templates document must provide it`,
      )
    }
  })

  return { errors, warnings }
}

const validateDedupe = (trigger: NotificationTrigger, owner: string): string[] => {
  const dedupe = trigger.dedupe
  if (dedupe === undefined) return []
  if (!dedupe || typeof dedupe.key !== 'string' || !dedupe.key.trim()) {
    return [`${owner} dedupe: key is required, e.g. order.paid:{{ order.id }}`]
  }
  const errors: string[] = []
  try {
    compileTemplate(dedupe.key)
  } catch (error) {
    errors.push(
      `${owner} dedupe: key is not a valid template (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (
    dedupe.windowSeconds !== undefined &&
    (!Number.isInteger(dedupe.windowSeconds) || dedupe.windowSeconds < 1)
  ) {
    errors.push(`${owner} dedupe: windowSeconds must be a positive integer`)
  }
  return errors
}

/** What starts a trigger: `event order.paid` or `collection orders:update`. */
const sourceKey = (trigger: NotificationTrigger) =>
  trigger.source.type === 'event'
    ? `event ${trigger.source.event}`
    : `collection ${trigger.source.collection}:${trigger.source.operation}`

/**
 * Warnings for triggers that start from the same source and deliver the same
 * channel to the same recipients without both having a dedupe key.
 */
export const findOverlappingTriggers = (triggers: NotificationTrigger[]): string[] => {
  const warnings: string[] = []
  for (let i = 0; i < triggers.length; i++) {
    for (let j = i + 1; j < triggers.length; j++) {
      const [a, b] = [triggers[i], triggers[j]]
      if (sourceKey(a) !== sourceKey(b) || (a.dedupe && b.dedupe)) continue
      const sameRecipients =
        JSON.stringify(a.recipients ?? [{ type: 'eventUser' }]) ===
        JSON.stringify(b.recipients ?? [{ type: 'eventUser' }])
      const channels = new Set(a.deliveries.map((delivery) => delivery.channel))
      const shared = b.deliveries.find((delivery) => channels.has(delivery.channel))
      if (sameRecipients && shared) {
        warnings.push(
          `triggers "${a.slug}" and "${b.slug}" both send ${shared.channel} to the same recipients on ${sourceKey(a)}; add a dedupe key if they describe the same action`,
        )
      }
    }
  }
  return warnings
}

const SCHEDULE_TYPES = new Set(['immediate', 'delay', 'at', 'relative'])
const TIMESTAMP_ROOTS = new Set(['event', 'payload', 'doc', 'previous', 'trigger'])

const validateSchedule = (
  trigger: NotificationTrigger,
  context: ConditionValidationContext,
): string[] => {
  const schedule = trigger.schedule
  if (!schedule) return []
  const label = `${context.owner} schedule`
  if (!SCHEDULE_TYPES.has(schedule.type)) {
    return [`${label}: type must be immediate, delay, at or relative`]
  }
  const errors: string[] = []
  if (schedule.type === 'delay' && parseDuration(schedule.delay) === undefined) {
    errors.push(`${label}: delay must be a duration such as 30m, 24h or 2d`)
  }
  if (schedule.type === 'relative' && parseDuration(schedule.offset) === undefined) {
    errors.push(`${label}: offset must be a duration such as -24h`)
  }
  if (schedule.type === 'at' || schedule.type === 'relative') {
    const root = typeof schedule.at === 'string' ? schedule.at.split('.')[0] : ''
    if (!root || (!TIMESTAMP_ROOTS.has(root) && !context.aliases.has(root))) {
      errors.push(`${label}: at must be a path such as event.payload.sendAt or booking.startsAt`)
    }
  }
  return errors
}

/** What a trigger's conditions may reference: event payload, doc/previous, source aliases. */
export const conditionContextFor = (
  trigger: NotificationTrigger,
  options: Pick<
    NormalizedNotificationsPluginOptions,
    'events' | 'conditions' | 'dataResolvers' | 'collectionEvents'
  >,
  owner = `trigger "${trigger.slug}"`,
): ConditionValidationContext => {
  const sources = trigger.data?.sources ?? []
  const aliases = new Map<string, string[] | undefined>()
  const documentAliases = new Set<string>()
  for (const source of sources) {
    if (source.type === 'collection' || source.type === 'document') {
      aliases.set(source.alias, source.type === 'collection' ? source.fields : source.fields)
    } else if (source.type === 'resolver') {
      const fields = options.dataResolvers[source.name]?.fields
      aliases.set(source.alias, fields?.length ? fields : undefined)
    } else {
      aliases.set(source.alias, undefined)
    }
    if (source.type === 'document') documentAliases.add(source.alias)
  }

  const eventName = trigger.source.type === 'event' ? trigger.source.event : undefined
  const sample = eventName ? options.events[eventName]?.samplePayload : undefined

  return {
    owner,
    aliases,
    documentAliases,
    custom: Object.keys(options.conditions),
    collectionSource: trigger.source.type === 'collection',
    capturedFields:
      trigger.source.type === 'collection'
        ? options.collectionEvents[trigger.source.collection]?.capture
        : undefined,
    payloadFields: sample ? collectFieldPaths(sample) : undefined,
  }
}

/** Startup warnings for all v2 code triggers (compiled legacy rules are skipped). */
export const collectTriggerWarnings = (options: NormalizedNotificationsPluginOptions): string[] => {
  const triggers = options.triggers.slice(options.rules.length)
  return [
    ...triggers.flatMap((trigger) => validateTrigger(trigger, options).warnings),
    ...findOverlappingTriggers(triggers),
  ]
}
