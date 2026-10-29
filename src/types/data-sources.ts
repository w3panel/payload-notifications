import type { Payload, PayloadRequest } from 'payload'
import type { NotificationEvent, NotificationEventSchema } from './events'

/**
 * Where a lookup reads its key from: a dot path rooted at `event` (e.g.
 * `event.payload.orderId`), `doc` / `previous` (collection events), or another
 * source's alias (e.g. `order.customer`).
 */
export type DataSourceLookup =
  | {
      /** Find a document by ID read from `from`. */
      type: 'id'
      from: string
    }
  | {
      /**
       * Follow a relationship value at `from`: an ID, a populated document, or an
       * array of either (`hasMany`).
       */
      type: 'relationship'
      from: string
    }

type DataSourceBase = {
  /** Name the resolved value is exposed under in the template context. */
  alias: string
  /** When true (default for collection/resolver), a missing value stops the notification. */
  required?: boolean
}

/** Exposes (a subset of) the event under an alias. */
export type EventDataSource = DataSourceBase & {
  type: 'event'
  /** Dot paths on the event to keep, e.g. `payload.orderId`. Defaults to the whole event. */
  fields?: string[]
}

/** The document that triggered a collection event (Phase 3). */
export type DocumentDataSource = DataSourceBase & {
  type: 'document'
  fields?: string[]
}

export type CollectionDataSource = DataSourceBase & {
  type: 'collection'
  collection: string
  lookup: DataSourceLookup
  /** Fields to load. Must be allowlisted in `data.collections[collection].fields`. */
  fields: string[]
  /** Relationship population depth, 0–2. Default 0. */
  depth?: number
  /** Cap for `hasMany` relationship lookups. Default 50, max 100. */
  maxItems?: number
}

/** Calls a developer-registered resolver from `dataResolvers`. */
export type ResolverDataSource = DataSourceBase & {
  type: 'resolver'
  name: string
  input?: Record<string, unknown>
}

/** Calls a developer-registered pure function from `computed` over the context so far. */
export type ComputedDataSource = DataSourceBase & {
  type: 'computed'
  name: string
}

export type NotificationDataSource =
  | EventDataSource
  | DocumentDataSource
  | CollectionDataSource
  | ResolverDataSource
  | ComputedDataSource

export type NotificationDataConfig = {
  sources: NotificationDataSource[]
}

/** Developer-controlled allowlist of collections and fields data sources may read. */
export type DataCollectionAllowlist = Record<
  string,
  {
    /** Field names (dot paths into groups allowed). `id` is always allowed. */
    fields: string[]
    label?: string
  }
>

export type NotificationsDataOptions = {
  collections?: DataCollectionAllowlist
  /** Dot paths masked in previews, inspectors and logs (e.g. `customer.phone`). */
  redact?: string[]
  /**
   * Extra field names treated as sensitive, on top of the built-in denylist
   * (`password`, `hash`, `salt`, `apiKey`, `*token*`, `*secret*`, …).
   */
  sensitiveFields?: string[]
}

/** Metadata about the occurrence, exposed to templates as `trigger`. */
export type NotificationTriggerInfo = {
  /** Event name, e.g. `order.paid`. */
  name: string
  eventId?: string
  occurredAt?: string
  classification?: 'transactional' | 'marketing'
  tenant?: string
}

/**
 * Template context produced by the data context builder. Keeps the legacy
 * `{ event, userId, payload }` shape (where `event` is the event name) and adds
 * `trigger`, `doc` / `previous` (collection events) and one key per source alias.
 */
export type NotificationDataContext = {
  event: string
  userId: string
  payload: Record<string, unknown>
  trigger: NotificationTriggerInfo
  doc?: Record<string, unknown> | null
  previous?: Record<string, unknown> | null
  [alias: string]: unknown
}

export type DataContextResult =
  | {
      ok: true
      context: NotificationDataContext
      /** Optional sources that resolved to null. */
      missing: string[]
    }
  | {
      ok: false
      reason: 'data-missing' | 'resolver-failed'
      /** Alias of the source that stopped the notification. */
      source: string
      message: string
    }

export type NotificationResolverArgs = {
  payload: Payload
  event: NotificationEvent
  /** Context resolved so far (earlier sources are available by alias). */
  context: NotificationDataContext
  /** Static input from the data source definition, validated against `input`. */
  input: Record<string, unknown>
  /** Aborted when the resolver times out. */
  signal: AbortSignal
  /**
   * The job request. Pass it to Payload writes (`payload.update({ …, req })`) so
   * collection events they cause are depth-tracked and join the job's transaction.
   */
  req?: PayloadRequest
}

export type NotificationDataResolverHandler = (
  args: NotificationResolverArgs,
) => unknown | Promise<unknown>

export type NotificationDataResolverDefinition = {
  handler: NotificationDataResolverHandler
  /** Shown in admin pickers. Defaults to the registry key. */
  label?: string
  description?: string
  /** Validates the source's `input` before the call. */
  input?: NotificationEventSchema
  /** Validates the resolver's return value before it enters the context. */
  output?: NotificationEventSchema
  /** Default 5000 ms, max 60000 ms. */
  timeoutMs?: number
  /** Output field paths offered to template authors (e.g. `name`, `supportEmail`). */
  fields?: string[]
}

export type NotificationDataResolverRegistry = Record<
  string,
  NotificationDataResolverHandler | NotificationDataResolverDefinition
>

export type NotificationComputedHandler = (
  context: NotificationDataContext,
) => unknown | Promise<unknown>

export type NotificationComputedDefinition = {
  handler: NotificationComputedHandler
  label?: string
  description?: string
  fields?: string[]
}

export type NotificationComputedRegistry = Record<
  string,
  NotificationComputedHandler | NotificationComputedDefinition
>

/** Serializable description of a resolver / computed function for admin pickers. */
export type RegisteredDataFunction = {
  name: string
  label: string
  description?: string
  fields: string[]
}
