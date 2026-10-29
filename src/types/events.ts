export type NotificationClassification = 'transactional' | 'marketing'

export type NotificationEventPayload = Record<string, unknown>

export type NotificationEvent = {
  name: string
  /** Stable identifier for this occurrence. Generated at emit time when omitted. */
  eventId?: string
  /** ISO timestamp of the occurrence. Defaults to emit time. */
  occurredAt?: string
  userId?: string
  payload?: NotificationEventPayload
  classification?: NotificationClassification
  idempotencyKey?: string
  /** Set for collection events: which collection and operation produced the event. */
  source?: { type: 'collection'; collection: string; operation: 'create' | 'update' | 'delete' }
  /** Collection events: captured fields of the document after the change. */
  doc?: Record<string, unknown> | null
  /** Collection events: captured fields of the document before an update. */
  previous?: Record<string, unknown> | null
  /** Tenant the event belongs to (`tenancy.field`); scopes lookups and role/query recipients. */
  tenant?: string
  /**
   * How many notification-processing levels produced this event (0 for user
   * actions). Events at `maxEventDepth` are not emitted, which breaks loops.
   */
  depth?: number
}

export type NotificationProcessEventJobInput = NotificationEvent

/**
 * Minimal Standard Schema v1 shape (https://standardschema.dev) so Zod, Valibot,
 * ArkType, etc. can be used without this package depending on any of them.
 */
export type StandardSchemaV1Like<Output = unknown> = {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
  }
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string
        readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
      }>
    }

/**
 * Validator function alternative to a Standard Schema: return the (optionally
 * transformed) payload, or throw to reject it.
 */
export type NotificationEventValidator = (
  payload: NotificationEventPayload,
) => NotificationEventPayload | Promise<NotificationEventPayload>

export type NotificationEventSchema = StandardSchemaV1Like | NotificationEventValidator

export type NotificationEventDefinition = {
  /** Human-readable name shown in admin pickers. Defaults to the event name. */
  label?: string
  description?: string
  /** Default classification for emits that omit one. */
  classification?: NotificationClassification
  /** Validated at emit time. */
  schema?: NotificationEventSchema
  /** Example payload used for previews, tests and field discovery in admin. */
  samplePayload?: NotificationEventPayload
  docsUrl?: string
}

export type NotificationEventRegistry = Record<string, NotificationEventDefinition>

/** Serializable description of a registered event, for admin pickers. */
export type RegisteredNotificationEvent = {
  name: string
  label: string
  description?: string
  classification?: NotificationClassification
  samplePayload?: NotificationEventPayload
  /** Dot paths available on the event payload, derived from `samplePayload`. */
  fields: string[]
  docsUrl?: string
  hasSchema: boolean
}

export type CollectionEventOperation = 'create' | 'update' | 'delete'

/** A collection admins and developers may build collection-event triggers on. */
export type CollectionEventConfig = {
  /** Default `['create', 'update']`. `delete` captures fields from the deleted document. */
  operations?: CollectionEventOperation[]
  /** Fields copied into `doc` / `previous` on the event (and usable in conditions). */
  capture: string[]
  label?: string
  /** Relationship / ID field whose value becomes `event.userId` (e.g. `customer`). */
  userField?: string
  /**
   * For updates, emit only when a captured field changed (default true), so
   * unrelated edits (e.g. notes) do not queue jobs.
   */
  onlyWhenCaptureChanges?: boolean
}

export type NormalizedCollectionEventConfig = Required<
  Pick<CollectionEventConfig, 'operations' | 'capture' | 'onlyWhenCaptureChanges'>
> &
  Pick<CollectionEventConfig, 'label' | 'userField'>
