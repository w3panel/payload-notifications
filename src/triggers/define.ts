import type {
  NotificationRule,
  NotificationTrigger,
  NotificationTriggerDefinition,
  NotificationTriggerInput,
} from '../types'
import { isValidEventName } from '../events/names'

const VALID_OPERATIONS = new Set(['create', 'update', 'delete'])
const VALID_POLICIES = new Set(['independent', 'managed', 'enforced'])

/** `order.paid`, `order.*` or `*`. */
export const isValidEventPattern = (pattern: string): boolean => {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) return isValidEventName(pattern.slice(0, -2))
  return isValidEventName(pattern)
}

const isLegacyRule = (trigger: unknown): trigger is NotificationRule => {
  return (
    typeof trigger === 'object' &&
    trigger !== null &&
    !('deliveries' in trigger) &&
    ('channels' in trigger || 'template' in trigger)
  )
}

/**
 * Structural checks that need no plugin options. Returns error messages
 * (empty when valid). Option-aware checks live in `validateTrigger`.
 */
export const checkTriggerShape = (trigger: NotificationTrigger): string[] => {
  const errors: string[] = []
  const label = `trigger "${String(trigger.slug)}"`

  if (typeof trigger.slug !== 'string' || !isValidEventName(trigger.slug)) {
    errors.push(
      `${label}: slug must use letters, numbers and single . _ : - separators (e.g. order-paid)`,
    )
  }

  const source = trigger.source as
    | { type?: string; event?: unknown; collection?: unknown; operation?: unknown }
    | undefined
  if (!source || (source.type !== 'event' && source.type !== 'collection')) {
    errors.push(`${label}: source must be { type: 'event', event } or { type: 'collection', … }`)
  } else if (source.type === 'event') {
    if (typeof source.event !== 'string' || !isValidEventPattern(source.event)) {
      errors.push(`${label}: source.event must be an event name or a trailing wildcard (order.*)`)
    }
  } else {
    if (typeof source.collection !== 'string' || !source.collection) {
      errors.push(`${label}: source.collection is required`)
    }
    if (!VALID_OPERATIONS.has(String(source.operation))) {
      errors.push(`${label}: source.operation must be create, update or delete`)
    }
  }

  if (!Array.isArray(trigger.deliveries) || trigger.deliveries.length === 0) {
    errors.push(`${label}: at least one delivery is required`)
  } else {
    trigger.deliveries.forEach((delivery, index) => {
      if (!delivery || typeof delivery.channel !== 'string' || !delivery.channel) {
        errors.push(`${label}: deliveries[${index}].channel is required`)
      }
      if (!delivery || typeof delivery.template !== 'string' || !delivery.template) {
        errors.push(`${label}: deliveries[${index}].template is required`)
      }
    })
  }

  if (trigger.recipients !== undefined && !Array.isArray(trigger.recipients)) {
    errors.push(`${label}: recipients must be an array`)
  }

  if (trigger.condition !== undefined && typeof trigger.condition !== 'function') {
    errors.push(`${label}: condition must be a function`)
  }

  const policy = trigger.admin?.policy
  if (policy !== undefined && !VALID_POLICIES.has(policy)) {
    errors.push(`${label}: admin.policy must be independent, managed or enforced`)
  }

  return errors
}

const toTrigger = (input: NotificationTriggerInput): NotificationTrigger => {
  if (input.source) return { enabled: true, ...input }
  const { event, ...rest } = input as Extract<NotificationTriggerInput, { event: string }>
  return { enabled: true, ...rest, source: { type: 'event', event } }
}

const defineLegacyRule = (
  trigger: NotificationTriggerDefinition,
): NotificationTriggerDefinition => {
  if (!trigger.event) {
    throw new Error('payload-notifications: trigger requires an event name')
  }
  if (!trigger.channels?.length) {
    throw new Error('payload-notifications: trigger requires at least one channel')
  }
  if (!trigger.template) {
    throw new Error('payload-notifications: trigger requires a template key')
  }
  return { enabled: true, ...trigger }
}

/**
 * Type-safe helper for defining notification triggers.
 *
 * Accepts the legacy rule shape (`event`, `channels`, `template`) — returned as a
 * rule for `rules: []` — or a v2 trigger with a stable `slug`, `recipients` and
 * `deliveries` for `triggers: []`:
 *
 * ```ts
 * defineTrigger({
 *   slug: 'order-paid-customer',
 *   event: 'order.paid',
 *   recipients: [{ type: 'context', path: 'customer.id', alias: 'customer' }],
 *   deliveries: [
 *     { channel: 'email', template: 'order.paid', recipient: 'customer' },
 *     { channel: 'inapp', template: 'order.paid', recipient: 'customer' },
 *   ],
 * })
 * ```
 */
export function defineTrigger(trigger: NotificationTriggerDefinition): NotificationTriggerDefinition
export function defineTrigger(trigger: NotificationTriggerInput): NotificationTrigger
export function defineTrigger(
  trigger: NotificationTriggerDefinition | NotificationTriggerInput,
): NotificationTriggerDefinition | NotificationTrigger {
  if (isLegacyRule(trigger)) return defineLegacyRule(trigger)

  const normalized = toTrigger(trigger as NotificationTriggerInput)
  const errors = checkTriggerShape(normalized)
  if (errors.length) {
    throw new Error(`payload-notifications: ${errors.join('; ')}`)
  }
  return normalized
}

/** Stable slug for a compiled legacy rule: `rule-<index>-<event>`. */
export const ruleSlug = (rule: NotificationRule, index: number): string =>
  `rule-${index}-${rule.event}`

/**
 * Compiles a legacy rule into a trigger: one delivery per channel to the event
 * user, using the rule's template, overrides, condition and data sources.
 */
export const ruleToTrigger = (rule: NotificationRule, index: number): NotificationTrigger => ({
  slug: ruleSlug(rule, index),
  source: { type: 'event', event: rule.event },
  enabled: rule.enabled !== false,
  condition: rule.condition,
  data: rule.data,
  recipients: [{ type: 'eventUser', alias: 'user' }],
  deliveries: rule.channels.map((channel) => ({
    channel,
    template: rule.template,
    recipient: 'user',
    templateOverrides: rule.templateOverrides?.[channel],
  })),
})
