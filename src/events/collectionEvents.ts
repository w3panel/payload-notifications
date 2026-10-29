import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'
import type {
  CollectionEventOperation,
  NormalizedCollectionEventConfig,
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationsPluginOptions,
} from '../types'
import { isObject, pickPaths, toRelationId } from '../data/paths'
import { collectCollectionFieldPaths } from '../data/sources'
import { createSensitiveFieldMatcher, isSensitivePath } from '../data/sensitive'
import { getEventDepth } from './depth'

const OPERATIONS: CollectionEventOperation[] = ['create', 'update', 'delete']

/** Event name for a collection change: `collection.orders.update`. */
export const collectionEventName = (collection: string, operation: CollectionEventOperation) =>
  `collection.${collection}.${operation}`

export const normalizeCollectionEvents = (
  collectionEvents: NotificationsPluginOptions['collectionEvents'],
): Record<string, NormalizedCollectionEventConfig> => {
  const normalized: Record<string, NormalizedCollectionEventConfig> = {}
  for (const [slug, entry] of Object.entries(collectionEvents ?? {})) {
    const label = `payload-notifications: collectionEvents["${slug}"]`
    if (
      !entry ||
      !Array.isArray(entry.capture) ||
      entry.capture.some((f) => typeof f !== 'string' || !f)
    ) {
      throw new Error(`${label}.capture must be an array of field names`)
    }
    const operations = entry.operations ?? ['create', 'update']
    if (
      !Array.isArray(operations) ||
      !operations.length ||
      operations.some((op) => !OPERATIONS.includes(op))
    ) {
      throw new Error(`${label}.operations must list create, update and/or delete`)
    }
    normalized[slug] = {
      operations: [...new Set(operations)],
      capture: [...new Set(entry.capture)],
      onlyWhenCaptureChanges: entry.onlyWhenCaptureChanges !== false,
      label: entry.label,
      userField: entry.userField,
    }
  }
  return normalized
}

/**
 * Checks collectionEvents against the Payload config: collections exist and are
 * not the plugin's own, captured / user fields exist and are not sensitive.
 */
export const validateCollectionEvents = (
  collections: CollectionConfig[],
  options: NormalizedNotificationsPluginOptions,
): string[] => {
  const errors: string[] = []
  const bySlug = new Map(collections.map((collection) => [collection.slug, collection]))
  const own = new Set(Object.values(options.collections))
  const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)

  for (const [slug, config] of Object.entries(options.collectionEvents)) {
    const label = `collectionEvents["${slug}"]`
    if (own.has(slug)) {
      errors.push(`${label}: notification collections cannot emit collection events`)
      continue
    }
    const collection = bySlug.get(slug)
    if (!collection) {
      errors.push(`${label}: collection does not exist in the Payload config`)
      continue
    }
    const available = collectCollectionFieldPaths(collection.fields)
    available.add('id')
    if (collection.timestamps !== false) {
      available.add('createdAt')
      available.add('updatedAt')
    }
    if (collection.auth) available.add('email')
    for (const field of config.capture) {
      if (isSensitivePath(field, isSensitive)) {
        errors.push(`${label}: field "${field}" is sensitive and cannot be captured`)
      } else if (!available.has(field)) {
        errors.push(`${label}: field "${field}" does not exist on the collection`)
      }
    }
    if (config.userField && !available.has(config.userField)) {
      errors.push(`${label}: userField "${config.userField}" does not exist on the collection`)
    }
  }
  return errors
}

const capture = (doc: unknown, fields: string[]): Record<string, unknown> | null =>
  isObject(doc) ? pickPaths(doc, fields) : null

/**
 * Builds the event for a collection change, or undefined when nothing relevant
 * changed (`onlyWhenCaptureChanges`).
 */
export const buildCollectionEvent = ({
  collection,
  config,
  operation,
  doc,
  previousDoc,
  tenancyField,
  depth,
}: {
  collection: string
  config: NormalizedCollectionEventConfig
  operation: CollectionEventOperation
  doc: unknown
  previousDoc?: unknown
  /** `tenancy.field`: copied from the full document into `event.tenant`. */
  tenancyField?: string
  depth?: number
}): NotificationEvent | undefined => {
  const current = capture(doc, config.capture)
  if (!current) return undefined
  const previous = operation === 'update' ? capture(previousDoc, config.capture) : null

  if (
    operation === 'update' &&
    config.onlyWhenCaptureChanges &&
    previous &&
    JSON.stringify(current) === JSON.stringify(previous)
  ) {
    return undefined
  }

  const userValue =
    config.userField && isObject(doc) ? toRelationId(doc[config.userField]) : undefined
  const tenantValue = tenancyField && isObject(doc) ? toRelationId(doc[tenancyField]) : undefined

  return {
    name: collectionEventName(collection, operation),
    source: { type: 'collection', collection, operation },
    userId: userValue !== undefined ? String(userValue) : undefined,
    payload: { id: (doc as Record<string, unknown>).id, collection, operation },
    doc: current,
    previous,
    ...(tenantValue !== undefined ? { tenant: String(tenantValue) } : {}),
    ...(depth ? { depth } : {}),
  }
}

export type QueueCollectionEvent = (args: {
  event: NotificationEvent
  req: PayloadRequest
}) => Promise<void>

/** afterChange / afterDelete hooks that emit events for one configured collection. */
export const createCollectionEventHooks = (
  collection: string,
  getOptions: () => NormalizedNotificationsPluginOptions,
  queueEvent: QueueCollectionEvent,
) => {
  const emit = async (
    operation: CollectionEventOperation,
    doc: unknown,
    previousDoc: unknown,
    req: PayloadRequest,
    context: Record<string, unknown> | undefined,
  ) => {
    const options = getOptions()
    const config = options.collectionEvents[collection]
    if (!config?.operations.includes(operation)) return
    if (req.context?.skipNotifications || context?.skipNotifications) return

    const depth = getEventDepth(req)
    if (depth >= options.maxEventDepth) {
      req.payload?.logger?.warn?.(
        `payload-notifications: skipped ${collectionEventName(collection, operation)} at depth ${depth} (maxEventDepth ${options.maxEventDepth}); a notification workflow may be writing to a hooked collection`,
      )
      return
    }

    const event = buildCollectionEvent({
      collection,
      config,
      operation,
      doc,
      previousDoc,
      tenancyField: options.tenancy?.field,
      depth,
    })
    if (event) await queueEvent({ event, req })
  }

  const afterChange: CollectionAfterChangeHook = async ({
    doc,
    previousDoc,
    operation,
    req,
    context,
  }) => {
    if (operation === 'create' || operation === 'update') {
      await emit(operation, doc, previousDoc, req, context)
    }
    return doc
  }

  const afterDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
    await emit('delete', doc, undefined, req, context)
    return doc
  }

  return { afterChange, afterDelete }
}

/** Adds the hooks to every configured collection (config time only). */
export const injectCollectionEventHooks = (
  collections: CollectionConfig[],
  getOptions: () => NormalizedNotificationsPluginOptions,
  queueEvent: QueueCollectionEvent,
): CollectionConfig[] => {
  const configured = getOptions().collectionEvents
  return collections.map((collection) => {
    if (!configured[collection.slug]) return collection
    const hooks = createCollectionEventHooks(collection.slug, getOptions, queueEvent)
    return {
      ...collection,
      hooks: {
        ...collection.hooks,
        afterChange: [...(collection.hooks?.afterChange ?? []), hooks.afterChange],
        afterDelete: [...(collection.hooks?.afterDelete ?? []), hooks.afterDelete],
      },
    }
  })
}
