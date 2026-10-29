import type { NotificationRule, NotificationTrigger, NotificationTriggerInput } from '../types'
import { checkTriggerShape, defineTrigger, ruleToTrigger } from './define'

/**
 * Compiles legacy rules and v2 trigger inputs into one list of code triggers.
 * Throws on invalid shapes or duplicate slugs.
 */
export const compileCodeTriggers = (
  rules: NotificationRule[],
  inputs: NotificationTriggerInput[] = [],
): NotificationTrigger[] => {
  if (!Array.isArray(inputs)) {
    throw new Error('payload-notifications: triggers must be an array')
  }

  const errors: string[] = []
  const compiled: NotificationTrigger[] = rules.map(ruleToTrigger)

  for (const input of inputs) {
    try {
      compiled.push(defineTrigger(input))
    } catch (error) {
      errors.push(
        (error instanceof Error ? error.message : String(error)).replace(
          'payload-notifications: ',
          '',
        ),
      )
    }
  }

  const seen = new Set<string>()
  for (const trigger of compiled) {
    errors.push(...checkTriggerShape(trigger).filter((error) => !errors.includes(error)))
    if (seen.has(trigger.slug)) {
      errors.push(`trigger "${trigger.slug}": duplicate slug (code trigger slugs must be unique)`)
    }
    seen.add(trigger.slug)
  }

  if (errors.length) {
    throw new Error(
      `payload-notifications: invalid triggers\n  - ${[...new Set(errors)].join('\n  - ')}`,
    )
  }

  return compiled
}
