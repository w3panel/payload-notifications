import type { NormalizedNotificationsPluginOptions, NotificationTrigger } from '../types'
import { DEFAULT_RECIPIENTS, recipientAlias } from '../recipients/resolve'
import { validateRecipientDefinitions } from '../recipients/validate'

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
    'channels' | 'templates' | 'recipientResolvers' | 'recipientQueries' | 'recipients'
  >,
  owner = `trigger "${trigger.slug}"`,
): TriggerValidationResult => {
  const definitions = trigger.recipients ?? DEFAULT_RECIPIENTS
  const errors = validateRecipientDefinitions(definitions, options, owner)
  const warnings: string[] = []

  const aliases = new Map(
    definitions.map((definition, index) => [recipientAlias(definition, index), definition]),
  )
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

/** Startup warnings for all v2 code triggers (compiled legacy rules are skipped). */
export const collectTriggerWarnings = (options: NormalizedNotificationsPluginOptions): string[] =>
  options.triggers
    .slice(options.rules.length)
    .flatMap((trigger) => validateTrigger(trigger, options).warnings)
