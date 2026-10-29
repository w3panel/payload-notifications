import type { NormalizedNotificationsPluginOptions, NotificationTrigger } from '../types'
import { DEFAULT_RECIPIENTS, recipientAlias } from '../recipients/resolve'
import { validateRecipientDefinitions } from '../recipients/validate'
import { collectFieldPaths } from '../events/registry'
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
  >,
  owner = `trigger "${trigger.slug}"`,
): TriggerValidationResult => {
  const definitions = trigger.recipients ?? DEFAULT_RECIPIENTS
  const errors = validateRecipientDefinitions(definitions, options, owner)
  const warnings: string[] = []

  const aliases = new Map(
    definitions.map((definition, index) => [recipientAlias(definition, index), definition]),
  )

  const conditionContext = conditionContextFor(trigger, options, owner)
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

/** What a trigger's conditions may reference: event payload, doc/previous, source aliases. */
export const conditionContextFor = (
  trigger: NotificationTrigger,
  options: Pick<NormalizedNotificationsPluginOptions, 'events' | 'conditions' | 'dataResolvers'>,
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
    payloadFields: sample ? collectFieldPaths(sample) : undefined,
  }
}

/** Startup warnings for all v2 code triggers (compiled legacy rules are skipped). */
export const collectTriggerWarnings = (options: NormalizedNotificationsPluginOptions): string[] =>
  options.triggers
    .slice(options.rules.length)
    .flatMap((trigger) => validateTrigger(trigger, options).warnings)
