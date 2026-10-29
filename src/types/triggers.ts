import type { NotificationChannel } from './channels'
import type { NotificationDataConfig } from './data-sources'
import type { NotificationClassification, NotificationEventPayload } from './events'
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

export type TriggerOverridableField = 'enabled' | 'recipients' | 'deliveries' | 'data'

export type NotificationDeliveryDefinition = {
  channel: NotificationChannel
  /** Template key (registry key / `notification-templates` slug). */
  template: string
  /** Recipient alias, or `all` (default). */
  recipient?: string
  templateOverrides?: Partial<NotificationTemplateDefinition>
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
  data?: NotificationDataConfig
  /** Defaults to the event user. */
  recipients?: NotificationRecipientDefinition[]
  deliveries: NotificationDeliveryDefinition[]
  /** Overrides the event classification for these deliveries. */
  classification?: NotificationClassification
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
