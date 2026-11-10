import type { Payload, Where } from 'payload'
import type { AdminTriggerRecord, NormalizedNotificationsPluginOptions } from '../types'
import { toAdminTriggerRecord, type TriggerDefinitionFields } from './record'

type TriggerDoc = { id: string | number; slug: string; name?: string; version?: number }
type VersionDoc = {
  trigger: string | number | { id: string | number }
  version: number
  definition: TriggerDefinitionFields
}

/** Where clause for one trigger's current published version. */
const currentVersionOf = (trigger: TriggerDoc): Where => ({
  and: [{ trigger: { equals: trigger.id } }, { version: { equals: trigger.version } }],
})

const idOf = (value: VersionDoc['trigger']) =>
  String(typeof value === 'object' && value !== null ? value.id : value)

/**
 * Loads the engine records of all published admin triggers: for each trigger
 * with status `published`, the snapshot of its current published version.
 */
export const loadPublishedAdminTriggers = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
): Promise<AdminTriggerRecord[]> => {
  const published = await payload.find({
    collection: options.collections.triggers as never,
    where: { status: { equals: 'published' } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    select: { slug: true, name: true, version: true } as never,
  })
  const triggers = published.docs as unknown as TriggerDoc[]
  if (!triggers.length) return []

  // Only the current published version of each trigger, never the full history.
  const current = triggers.filter((trigger) => typeof trigger.version === 'number')
  if (!current.length) return []
  const versions = await payload.find({
    collection: options.collections.triggerVersions as never,
    where: {
      or: current.map(currentVersionOf),
    },
    limit: current.length,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    select: { trigger: true, version: true, definition: true } as never,
  })
  const snapshots = new Map(
    (versions.docs as unknown as VersionDoc[]).map((doc) => [
      `${idOf(doc.trigger)}::${doc.version}`,
      doc,
    ]),
  )

  return triggers.flatMap((trigger) => {
    const snapshot = snapshots.get(`${trigger.id}::${trigger.version}`)
    return snapshot
      ? [toAdminTriggerRecord(trigger.slug, snapshot.version, snapshot.definition, trigger.name)]
      : []
  })
}

export type AdminTriggerCache = {
  /** Published admin triggers, reloaded when older than `adminTriggers.cacheTtlMs`. */
  get: (payload: Payload) => Promise<AdminTriggerRecord[]>
  /** Forces the next `get` to reload (called after publish / disable on this instance). */
  invalidate: () => void
}

/**
 * Per-instance cache of published admin triggers. Other instances pick up
 * changes within the TTL. Load failures keep the last good list and are logged.
 */
export const createAdminTriggerCache = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  now: () => number = Date.now,
): AdminTriggerCache => {
  let records: AdminTriggerRecord[] = []
  let loadedAt = Number.NEGATIVE_INFINITY
  let pending: Promise<AdminTriggerRecord[]> | undefined

  return {
    get: async (payload) => {
      const options = getOptions()
      if (now() - loadedAt < options.adminTriggers.cacheTtlMs) return records
      pending ??= loadPublishedAdminTriggers(payload, options)
        .then((loaded) => {
          records = loaded
          loadedAt = now()
          return records
        })
        .catch((error) => {
          payload.logger?.error?.(
            { err: error },
            'payload-notifications: failed to load admin triggers; using the last loaded set',
          )
          return records
        })
        .finally(() => {
          pending = undefined
        })
      return pending
    },
    invalidate: () => {
      loadedAt = Number.NEGATIVE_INFINITY
    },
  }
}
