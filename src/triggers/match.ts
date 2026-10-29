import type { EffectiveTrigger, TriggerAdminPolicy, TriggerOrigin } from '../types'

export type TriggerMatchInput =
  | { type: 'event'; name: string }
  | { type: 'collection'; collection: string; operation: 'create' | 'update' | 'delete' }

/** Recorded on deliveries and logs: which trigger version and policy produced them. */
export type TriggerSnapshot = {
  slug: string
  origin: TriggerOrigin
  version: number
  policy: TriggerAdminPolicy | 'admin'
  overrideOf?: string
}

/** `order.paid` matches `order.paid`, `order.*` and `*`. */
export const eventMatchesPattern = (name: string, pattern: string): boolean => {
  if (pattern === '*' || pattern === name) return true
  if (pattern.endsWith('.*')) return name.startsWith(pattern.slice(0, -1))
  return false
}

/** Enabled triggers whose source matches the input, in registry order. */
export const matchTriggers = (
  triggers: EffectiveTrigger[],
  input: TriggerMatchInput,
): EffectiveTrigger[] => {
  return triggers.filter(({ trigger }) => {
    if (trigger.enabled === false) return false
    const source = trigger.source
    if (input.type === 'event') {
      return source.type === 'event' && eventMatchesPattern(input.name, source.event)
    }
    return (
      source.type === 'collection' &&
      source.collection === input.collection &&
      source.operation === input.operation
    )
  })
}

export const snapshotTrigger = (entry: EffectiveTrigger): TriggerSnapshot => ({
  slug: entry.trigger.slug,
  origin: entry.origin,
  version: entry.version,
  policy: entry.policy,
  ...(entry.overrideOf ? { overrideOf: entry.overrideOf } : {}),
})
