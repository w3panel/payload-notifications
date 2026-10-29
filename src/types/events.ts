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
