import type {
  AdminTriggerRecord,
  EffectiveTrigger,
  NotificationTrigger,
  TriggerOverridableField,
} from '../types'
import { checkTriggerShape } from './define'

export const OVERRIDABLE_FIELDS: TriggerOverridableField[] = [
  'enabled',
  'recipients',
  'deliveries',
  'data',
  'conditions',
  'schedule',
  'dedupe',
]

/** Record keys that describe the record itself rather than trigger behaviour. */
const RECORD_META_KEYS = new Set(['slug', 'version', 'overrides', 'name', 'description', 'id'])

export type EffectiveTriggersResult = {
  triggers: EffectiveTrigger[]
  /** Admin records that were rejected, with the reason. Never merged silently. */
  errors: string[]
}

const codeEntry = (trigger: NotificationTrigger): EffectiveTrigger => ({
  trigger,
  origin: 'code',
  version: 1,
  policy: trigger.admin?.policy ?? 'independent',
})

/**
 * Combines code triggers with published admin trigger records:
 *
 * - Standalone admin records (no `overrides`) run alongside code triggers and
 *   may not reuse a code slug.
 * - `overrides: <codeSlug>` replaces a `managed` code trigger's overridable
 *   fields only; records touching other fields, or targeting `independent` /
 *   `enforced` triggers, are rejected.
 */
export const resolveEffectiveTriggers = (
  codeTriggers: NotificationTrigger[],
  adminRecords: AdminTriggerRecord[] = [],
): EffectiveTriggersResult => {
  const errors: string[] = []
  const entries = codeTriggers.map(codeEntry)
  const codeIndex = new Map(codeTriggers.map((trigger, index) => [trigger.slug, index]))
  const overridden = new Set<string>()
  const adminSlugs = new Set<string>()

  for (const record of adminRecords) {
    const label = `admin trigger "${record.slug}"`

    if (adminSlugs.has(record.slug)) {
      errors.push(`${label}: duplicate slug`)
      continue
    }
    adminSlugs.add(record.slug)

    if (record.overrides) {
      const index = codeIndex.get(record.overrides)
      if (index === undefined) {
        errors.push(`${label}: overrides unknown code trigger "${record.overrides}"`)
        continue
      }
      const target = codeTriggers[index]
      const policy = target.admin?.policy ?? 'independent'
      if (policy !== 'managed') {
        errors.push(`${label}: code trigger "${target.slug}" is ${policy} and cannot be overridden`)
        continue
      }
      if (overridden.has(target.slug)) {
        errors.push(`${label}: code trigger "${target.slug}" already has a managed override`)
        continue
      }

      const allowed = new Set(target.admin?.overridable ?? OVERRIDABLE_FIELDS)
      const touched = Object.keys(record).filter(
        (key) =>
          !RECORD_META_KEYS.has(key) && record[key as keyof AdminTriggerRecord] !== undefined,
      )
      const forbidden = touched.filter((key) => !allowed.has(key as TriggerOverridableField))
      if (forbidden.length) {
        errors.push(
          `${label}: fields ${forbidden.map((key) => `"${key}"`).join(', ')} are not overridable on "${target.slug}"`,
        )
        continue
      }

      const merged: NotificationTrigger = { ...target }
      for (const key of touched) {
        ;(merged as Record<string, unknown>)[key] = record[key as keyof AdminTriggerRecord]
      }
      const shapeErrors = checkTriggerShape(merged)
      if (shapeErrors.length) {
        errors.push(...shapeErrors.map((error) => `${label}: ${error}`))
        continue
      }

      overridden.add(target.slug)
      entries[index] = {
        trigger: merged,
        origin: 'admin',
        version: record.version,
        policy: 'managed',
        overrideOf: target.slug,
      }
      continue
    }

    if (codeIndex.has(record.slug)) {
      errors.push(
        `${label}: slug is used by a code trigger (set overrides to manage a managed trigger)`,
      )
      continue
    }

    const { version, overrides: _overrides, ...rest } = record
    const trigger = { enabled: true, ...rest } as NotificationTrigger
    const shapeErrors = checkTriggerShape(trigger)
    if (shapeErrors.length) {
      errors.push(...shapeErrors.map((error) => `${label}: ${error}`))
      continue
    }
    entries.push({ trigger, origin: 'admin', version, policy: 'admin' })
  }

  return { triggers: entries, errors }
}
