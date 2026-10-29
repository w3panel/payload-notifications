import type { Payload, PayloadRequest } from 'payload'
import type {
  CollectionDataSource,
  NotificationComputedDefinition,
  NotificationDataResolverDefinition,
  DataContextResult,
  NotificationDataContext,
  NotificationDataSource,
  NotificationEvent,
} from '../types'
import { getPath, isObject, pickPaths, toRelationId, toSelect } from './paths'
import { ResolverError, runComputed, runDataResolver } from './resolvers'
import {
  defaultSensitiveFieldMatcher,
  stripSensitiveFields,
  type SensitiveFieldMatcher,
} from './sensitive'
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
  /** Request whose user and transaction lookups run under (e.g. admin preview with `overrideAccess: false`). */
  req?: PayloadRequest
  /** Label used in messages, e.g. `trigger "order-paid"`. */
  owner?: string
  /** Registered resolvers (normalized `options.dataResolvers`). */
  dataResolvers?: Record<string, NotificationDataResolverDefinition>
  /** Registered computed functions (normalized `options.computed`). */
  computed?: Record<string, NotificationComputedDefinition>
  /** Sensitive-field matcher applied to every lookup and resolver result. */
  isSensitive?: SensitiveFieldMatcher
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
  req: PayloadRequest | undefined,
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
      ...(req ? { req } : {}),
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
    ...(req ? { req } : {}),
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
  req,
  owner = 'data sources',
  dataResolvers = {},
  computed = {},
  isSensitive = defaultSensitiveFieldMatcher,
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
  if (doc !== undefined) context.doc = stripSensitiveFields(doc, isSensitive) as typeof doc
  if (previous !== undefined) {
    context.previous = stripSensitiveFields(previous, isSensitive) as typeof previous
  }

  /** Lookup scope: like the context, but `event` is the full event object. */
  const scope: Record<string, unknown> = {
    event,
    doc: context.doc,
    previous: context.previous,
  }
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
          value = await loadCollectionSource(source, scope, payload, overrideAccess, req)
          break
        case 'resolver': {
          const definition = dataResolvers[source.name]
          if (!definition) {
            throw new ResolverError(source.name, 'error', 'is not registered in dataResolvers')
          }
          value = await runDataResolver({
            name: source.name,
            definition,
            payload,
            event,
            context,
            input: source.input,
          })
          break
        }
        case 'computed': {
          const definition = computed[source.name]
          if (!definition) {
            throw new ResolverError(source.name, 'error', 'is not registered in computed')
          }
          value = await runComputed({ name: source.name, definition, context })
          break
        }
      }
    } catch (error) {
      if (error instanceof ResolverError) {
        payload.logger?.warn?.(
          { err: error, resolver: error.resolver, kind: error.kind, source: source.alias },
          `${owner}: ${error.message}`,
        )
        if (isRequired(source)) {
          return {
            ok: false,
            reason: 'resolver-failed',
            source: source.alias,
            message: error.message,
          }
        }
        value = null
      } else if (error instanceof MissingSourceError) {
        if (isRequired(source)) {
          return { ok: false, reason: 'data-missing', source: source.alias, message: error.message }
        }
        value = null
      } else {
        throw error
      }
    }

    // Event payloads are developer-provided; everything loaded or computed is stripped.
    if (source.type !== 'event') value = stripSensitiveFields(value, isSensitive)

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
