import type { Payload } from 'payload'
import type {
  CollectionDataSource,
  DataContextResult,
  NotificationDataContext,
  NotificationDataSource,
  NotificationEvent,
} from '../types'
import { getPath, isObject, pickPaths, toRelationId, toSelect } from './paths'
import { DEFAULT_MAX_ITEMS, orderDataSources } from './sources'

export type BuildDataContextArgs = {
  payload: Payload
  event: NotificationEvent
  sources?: NotificationDataSource[]
  /** Triggering document for collection events. */
  doc?: Record<string, unknown> | null
  previous?: Record<string, unknown> | null
  /** Recipient user ID for the legacy `userId` key. Defaults to `event.userId`. */
  userId?: string
  /**
   * Run lookups with `overrideAccess` (default true: notifications are server-side
   * work and read only allowlisted fields).
   */
  overrideAccess?: boolean
  /** Label used in messages, e.g. `trigger "order-paid"`. */
  owner?: string
}

class MissingSourceError extends Error {
  constructor(
    readonly alias: string,
    message: string,
  ) {
    super(message)
  }
}

const isRequired = (source: NotificationDataSource): boolean => {
  if (source.type === 'event') return false
  return source.required !== false
}

const loadCollectionSource = async (
  source: CollectionDataSource,
  scope: Record<string, unknown>,
  payload: Payload,
  overrideAccess: boolean,
): Promise<unknown> => {
  const raw = getPath(scope, source.lookup.from)
  const select = toSelect(source.fields)
  const depth = source.depth ?? 0

  if (raw === undefined || raw === null || raw === '') return null

  if (Array.isArray(raw)) {
    if (source.lookup.type === 'id') {
      throw new MissingSourceError(
        source.alias,
        `lookup "${source.lookup.from}" is a list; use a relationship lookup for hasMany values`,
      )
    }
    const maxItems = source.maxItems ?? DEFAULT_MAX_ITEMS
    const ids = raw
      .map(toRelationId)
      .filter((id): id is string | number => id !== undefined)
      .slice(0, maxItems)
    if (!ids.length) return []

    const result = await payload.find({
      collection: source.collection as never,
      where: { id: { in: ids } },
      limit: ids.length,
      depth,
      select: select as never,
      overrideAccess,
      pagination: false,
    })
    const byId = new Map(
      (result.docs as Record<string, unknown>[]).map((doc) => [String(doc.id), doc]),
    )
    return ids
      .map((id) => byId.get(String(id)))
      .filter((doc): doc is Record<string, unknown> => Boolean(doc))
      .map((doc) => pickPaths(doc, source.fields))
  }

  const id = toRelationId(raw)
  if (id === undefined) {
    throw new MissingSourceError(
      source.alias,
      `lookup "${source.lookup.from}" did not resolve to an ID`,
    )
  }

  const doc = await payload.findByID({
    collection: source.collection as never,
    id,
    depth,
    select: select as never,
    overrideAccess,
    disableErrors: true,
  })
  return isObject(doc) ? pickPaths(doc, source.fields) : null
}

/**
 * Resolves data sources in dependency order into a template context.
 *
 * - Lookup paths (`lookup.from`) read from `event` (the full event object),
 *   `doc`, `previous` and earlier aliases.
 * - Templates keep `{{ event }}` (name), `{{ userId }}` and `{{ payload.* }}`,
 *   plus `{{ trigger.* }}` and one key per alias.
 * - A required source that resolves to nothing stops with `data-missing`;
 *   optional sources become `null`. Values are never fabricated.
 * - Unexpected lookup errors (DB/network) are thrown so the job can retry.
 */
export const buildDataContext = async ({
  payload,
  event,
  sources = [],
  doc,
  previous,
  userId,
  overrideAccess = true,
  owner = 'data sources',
}: BuildDataContextArgs): Promise<DataContextResult> => {
  const context: NotificationDataContext = {
    event: event.name,
    userId: userId ?? event.userId ?? '',
    payload: event.payload ?? {},
    trigger: {
      name: event.name,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      classification: event.classification,
    },
  }
  if (doc !== undefined) context.doc = doc
  if (previous !== undefined) context.previous = previous

  /** Lookup scope: like the context, but `event` is the full event object. */
  const scope: Record<string, unknown> = { event, doc, previous }
  const missing: string[] = []

  for (const source of orderDataSources(sources, owner)) {
    let value: unknown

    try {
      switch (source.type) {
        case 'event':
          value = source.fields?.length
            ? pickPaths(event as unknown as Record<string, unknown>, source.fields)
            : event
          break
        case 'document':
          value = isObject(doc)
            ? source.fields?.length
              ? pickPaths(doc, source.fields)
              : doc
            : null
          break
        case 'collection':
          value = await loadCollectionSource(source, scope, payload, overrideAccess)
          break
        case 'resolver':
        case 'computed':
          throw new Error(`${source.type} sources are not supported yet`)
      }
    } catch (error) {
      if (!(error instanceof MissingSourceError)) throw error
      if (isRequired(source)) {
        return { ok: false, reason: 'data-missing', source: source.alias, message: error.message }
      }
      value = null
    }

    const isEmpty = value === null || value === undefined
    if (isEmpty && isRequired(source)) {
      return {
        ok: false,
        reason: 'data-missing',
        source: source.alias,
        message: `${owner}: required source "${source.alias}" resolved to nothing`,
      }
    }
    if (isEmpty) missing.push(source.alias)

    context[source.alias] = isEmpty ? null : value
    scope[source.alias] = isEmpty ? null : value
  }

  return { ok: true, context, missing }
}
