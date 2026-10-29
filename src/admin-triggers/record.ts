import type { AdminTriggerRecord, NotificationTrigger } from '../types'
import { isObject } from '../data/paths'
import { OVERRIDABLE_FIELDS } from '../triggers/registry'

/** Document fields that make up a trigger definition (everything a publish snapshots). */
export const DEFINITION_FIELDS = [
  'source',
  'conditions',
  'data',
  'recipients',
  'deliveries',
  'schedule',
  'dedupe',
  'reliability',
  'classification',
  'overrides',
] as const

export type TriggerDefinitionFields = Partial<
  Pick<
    NotificationTrigger,
    | 'source'
    | 'conditions'
    | 'data'
    | 'recipients'
    | 'deliveries'
    | 'schedule'
    | 'dedupe'
    | 'classification'
  >
> & { overrides?: string | null }

/** Extracts the definition from a trigger document (or form values). */
export const definitionOf = (doc: Record<string, unknown>): TriggerDefinitionFields => {
  const definition: Record<string, unknown> = {}
  for (const field of DEFINITION_FIELDS) {
    const value = doc[field]
    if (value !== undefined && value !== null && value !== '') definition[field] = value
  }
  return definition as TriggerDefinitionFields
}

/** Stable comparison of two definitions (used to detect unpublished changes). */
export const sameDefinition = (a: TriggerDefinitionFields, b: TriggerDefinitionFields): boolean =>
  JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  )
}

/**
 * Builds the engine record for a published snapshot. Managed overrides keep
 * only the fields they set; standalone triggers are full definitions.
 */
export const toAdminTriggerRecord = (
  slug: string,
  version: number,
  definition: TriggerDefinitionFields,
  name?: string,
): AdminTriggerRecord => {
  const { overrides, ...rest } = definition
  const record: AdminTriggerRecord = { slug, version, ...(name ? { name } : {}) }
  // Managed overrides carry only overridable fields; everything else comes from code.
  const allowed = overrides ? new Set<string>(OVERRIDABLE_FIELDS) : undefined
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue
    if (allowed && !allowed.has(key)) continue
    ;(record as Record<string, unknown>)[key] = value
  }
  if (overrides) record.overrides = overrides
  return record
}
