import type { Payload } from 'payload'
import type { NotificationChannel } from './channels'
import type { NotificationDataConfig } from './data-sources'
import type {
  NotificationClassification,
  NotificationEvent,
  NotificationEventPayload,
} from './events'
import type { NotificationRecipientDefinition } from './recipients'
import type { NotificationTemplateDefinition } from './templates'

export type NotificationRule = {
  event: string
  channels: NotificationChannel[]
  template: string
  enabled?: boolean
  condition?: (payload: NotificationEventPayload) => boolean | Promise<boolean>
  templateOverrides?: Partial<Record<NotificationChannel, Partial<NotificationTemplateDefinition>>>
  /** Data sources resolved into the template context before rendering. */
  data?: NotificationDataConfig
}

export type NotificationTriggerDefinition = NotificationRule

export type TriggerEventSource = {
  type: 'event'
  /** Event name, or a trailing wildcard such as `order.*`. */
  event: string
}

export type TriggerCollectionSource = {
  type: 'collection'
  collection: string
  operation: 'create' | 'update' | 'delete'
}

export type TriggerSource = TriggerEventSource | TriggerCollectionSource

/**
 * How admin-created triggers interact with a code trigger:
 * - `independent` (default): admin triggers on the same event run separately.
 * - `managed`: an admin record with `overrides: <slug>` may replace the `overridable` fields.
 * - `enforced`: shown read-only in admin; cannot be disabled or overridden.
 */
export type TriggerAdminPolicy = 'independent' | 'managed' | 'enforced'

export type TriggerOverridableField =
  | 'enabled'
  | 'recipients'
  | 'deliveries'
  | 'data'
  | 'conditions'
  | 'schedule'
  | 'dedupe'
  | 'reliability'

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'in'
  | 'notIn'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'exists'
  | 'contains'
  | 'changed'
  | 'changedTo'
  | 'changedFrom'

/**
 * Compares the value at `field` (a dot path such as `doc.status`,
 * `event.payload.total` or `order.total`). Change operators compare `doc.*` (or
 * a `document` source alias) with the same path on `previous`.
 */
export type FieldCondition = {
  field: string
  operator: ConditionOperator
  value?: unknown
}

/** Calls a developer-registered condition from the plugin `conditions` option. */
export type CustomCondition = { custom: string; input?: Record<string, unknown> }

/** JSON condition tree. Never executes admin-provided code. */
export type NotificationCondition =
  | { all: NotificationCondition[] }
  | { any: NotificationCondition[] }
  | { not: NotificationCondition }
  | FieldCondition
  | CustomCondition

export type ConditionHandler = (args: {
  /** Evaluation scope: `event`, `payload`, `doc`, `previous`, source aliases, `recipient`. */
  scope: Record<string, unknown>
  event: NotificationEvent
  input: Record<string, unknown>
  payload: Payload
}) => boolean | Promise<boolean>

/** A developer-registered condition, referenced from JSON as `{ custom: name }`. */
export type ConditionDefinition = {
  handler: ConditionHandler
  label?: string
  description?: string
}

/** Retry policy for retryable send failures (rate limits, 5xx, refused connections). */
export type NotificationRetryPolicy = {
  /** Total attempts including the first. */
  attempts?: number
  backoff?: {
    type?: 'exponential' | 'fixed'
    /** Base delay. Default 5000 ms. */
    delayMs?: number
    /** Cap for exponential delays. Default 1 hour. */
    maxDelayMs?: number
  }
  /** Randomize delays (50–100% of the computed delay). Default true. */
  jitter?: boolean
}

export type NotificationTriggerReliability = NotificationRetryPolicy & {
  /** Per-channel overrides, e.g. fewer attempts for SMS. */
  channels?: Partial<Record<NotificationChannel, NotificationRetryPolicy>>
}

export type NotificationDedupe = {
  /** Template rendered against the trigger context, e.g. `order.paid:{{ order.id }}`. */
  key: string
  /** Only deliveries created within this many seconds count. Default: any age. */
  windowSeconds?: number
}

/** A duration in milliseconds, or a string such as `30m`, `24h`, `2d`, `-24h`. */
export type NotificationDuration = number | string

export type NotificationSchedule =
  | { type: 'immediate' }
  /** Send `delay` after the event. */
  | { type: 'delay'; delay: NotificationDuration }
  /** Send at the timestamp found at `at` (e.g. `event.payload.sendAt`). */
  | { type: 'at'; at: string }
  /** Send `offset` relative to the timestamp at `at` (e.g. `-24h` before `booking.startsAt`). */
  | { type: 'relative'; at: string; offset: NotificationDuration }

export type NotificationScheduleOptions = {
  /**
   * Re-load data and re-evaluate `conditions` / `when` when a scheduled delivery
   * is due; cancel it when they no longer match (e.g. booking cancelled).
   */
  recheckConditions?: boolean
  /** Skip (instead of sending immediately) when the computed time is already past. */
  skipIfPast?: boolean
}

export type NotificationDeliveryDefinition = {
  channel: NotificationChannel
  /** Template key (registry key / `notification-templates` slug). */
  template: string
  /** Recipient alias, or `all` (default). */
  recipient?: string
  templateOverrides?: Partial<NotificationTemplateDefinition>
  /** Per-recipient condition; the context also has `recipient.*`. */
  when?: NotificationCondition
  /** Another channel to try when this delivery cannot be sent. */
  fallback?: NotificationDeliveryFallback
}

export type NotificationDeliveryFallback = {
  channel: NotificationChannel
  /** Defaults to the delivery's template. */
  template?: string
  /**
   * When to fall back. Default: all. Never for `unknown` outcomes (the first
   * message may have been sent).
   */
  on?: Array<'permanent' | 'no-destination' | 'policy'>
}

export type NotificationTrigger = {
  /** Stable identifier, e.g. `order-paid-customer`. */
  slug: string
  name?: string
  description?: string
  source: TriggerSource
  enabled?: boolean
  /** Developer-only predicate over the event payload (code triggers). */
  condition?: (payload: NotificationEventPayload) => boolean | Promise<boolean>
  /** JSON conditions; evaluated before data loading when they only read event / doc fields. */
  conditions?: NotificationCondition
  data?: NotificationDataConfig
  /** Defaults to the event user. */
  recipients?: NotificationRecipientDefinition[]
  deliveries: NotificationDeliveryDefinition[]
  /** Overrides the event classification for these deliveries. */
  classification?: NotificationClassification
  /**
   * Preference category users opt in / out of (e.g. `order-updates`,
   * `newsletter`). Defaults to the classification.
   */
  category?: string
  /** When deliveries are sent. Default: immediately. */
  schedule?: NotificationSchedule & NotificationScheduleOptions
  /**
   * Cross-trigger duplicate protection: deliveries with the same rendered `key`,
   * recipient and channel (within `windowSeconds`, if set) are skipped as
   * duplicates — e.g. `order.paid:{{ order.id }}` on both an `order.paid` event
   * trigger and an `orders` update trigger.
   */
  dedupe?: NotificationDedupe
  /** Retry policy for this trigger's deliveries (within `reliability.maxAttempts`). */
  reliability?: NotificationTriggerReliability
  admin?: {
    policy?: TriggerAdminPolicy
    /** Fields a `managed` override may replace. Default: all overridable fields. */
    overridable?: TriggerOverridableField[]
  }
}

/** `defineTrigger` input: `source` may be given as the `event` shorthand. */
export type NotificationTriggerInput =
  | NotificationTrigger
  | (Omit<NotificationTrigger, 'source'> & { event: string; source?: undefined })

export type TriggerOrigin = 'code' | 'admin'

/** A trigger as matched for an event, with where it came from and the version used. */
export type EffectiveTrigger = {
  trigger: NotificationTrigger
  origin: TriggerOrigin
  version: number
  /** Policy that produced this trigger: the code policy, or `admin` for standalone admin triggers. */
  policy: TriggerAdminPolicy | 'admin'
  /** For managed overrides: the admin record that replaced overridable fields. */
  overrideOf?: string
}

/** A published admin-created trigger (stored in `notification-triggers`, Phase 4). */
export type AdminTriggerRecord = Partial<Omit<NotificationTrigger, 'condition' | 'admin'>> & {
  slug: string
  version: number
  /** Code trigger slug this record manages. */
  overrides?: string
}
