import type { NotificationChannel } from './channels'
import type {
  DataCollectionAllowlist,
  NotificationComputedDefinition,
  NotificationComputedRegistry,
  NotificationDataResolverDefinition,
  NotificationDataResolverRegistry,
  NotificationsDataOptions,
} from './data-sources'
import type { NotificationObservabilityHook } from './deliveries'
import type { NotificationEventRegistry } from './events'
import type {
  NotificationPolicyContext,
  NotificationPolicyDecision,
  PreferenceFieldMapping,
} from './policy'
import type { EmailProviderConfig, SMSProviderConfig, WhatsAppProviderConfig } from './providers'
import type { NotificationTemplateRegistry } from './templates'
import type {
  NotificationRecipientQueryDefinition,
  NotificationRecipientResolverDefinition,
  NotificationRecipientsOptions,
} from './recipients'
import type {
  ConditionDefinition,
  ConditionHandler,
  NotificationRule,
  NotificationTrigger,
  NotificationTriggerInput,
} from './triggers'

export type NotificationsJobsOptions = {
  /** Named Payload jobs queue. Defaults to `notifications`. */
  queue?: string
}

export type NotificationsPluginOptions = {
  enabled?: boolean
  channels?: NotificationChannel[]
  userCollectionSlug?: string
  collections?: {
    notifications?: string
    logs?: string
    templates?: string
    deliveries?: string
  }
  jobs?: NotificationsJobsOptions
  templates?: {
    email?: string
    whatsapp?: string
    sms?: string
    registry?: NotificationTemplateRegistry
    /**
     * When true, seed missing `notification-templates` docs from the code registry on `onInit`.
     * Default false (idempotent skip-existing when enabled).
     */
    seedOnInit?: boolean
  }
  providers?: {
    email?: EmailProviderConfig
    whatsapp?: Partial<WhatsAppProviderConfig>
    sms?: Partial<SMSProviderConfig>
  }
  preferences?: {
    fields?: PreferenceFieldMapping
  }
  policy?: {
    canSend?: (
      context: NotificationPolicyContext,
    ) => NotificationPolicyDecision | Promise<NotificationPolicyDecision>
  }
  observability?: {
    onDispatch?: NotificationObservabilityHook
  }
  rules?: NotificationRule[]
  /** Registered application events (label, schema, default classification, sample payload). */
  events?: NotificationEventRegistry
  /** Reject emits for events not present in `events`. Default false. */
  eventsStrict?: boolean
  /** Collections/fields data sources may read, and paths to redact. */
  data?: NotificationsDataOptions
  /** Developer-registered data resolvers that data sources can call by name. */
  dataResolvers?: NotificationDataResolverRegistry
  /** Developer-registered pure functions over the resolved context. */
  computed?: NotificationComputedRegistry
  /** Code-defined triggers (v2). Legacy `rules` are compiled into triggers too. */
  triggers?: NotificationTriggerInput[]
  /** Recipient resolution settings (destination fields, roles, caps). */
  recipients?: NotificationRecipientsOptions
  /** Developer-registered recipient resolvers, selectable as `{ type: 'resolver', name }`. */
  recipientResolvers?: Record<
    string,
    NotificationRecipientResolverDefinition | NotificationRecipientResolverDefinition['handler']
  >
  /** Developer-registered named user queries, selectable as `{ type: 'query', name }`. */
  recipientQueries?: Record<string, NotificationRecipientQueryDefinition>
  /** Developer-registered conditions, referenced from JSON as `{ custom: name }`. */
  conditions?: Record<string, ConditionHandler | ConditionDefinition>
}

export type NormalizedNotificationsPluginOptions = {
  enabled: boolean
  channels: NotificationChannel[]
  userCollectionSlug: string
  collections: {
    notifications: string
    logs: string
    templates: string
    deliveries: string
  }
  jobs: {
    queue: string
  }
  templates: {
    email?: string
    whatsapp?: string
    sms?: string
    registry: NotificationTemplateRegistry
    seedOnInit: boolean
  }
  providers: {
    email?: EmailProviderConfig
    whatsapp?: Partial<WhatsAppProviderConfig>
    sms?: Partial<SMSProviderConfig>
  }
  preferences: {
    fields: {
      channels: string
      marketingConsent: string
    }
  }
  policy: {
    canSend?: (
      context: NotificationPolicyContext,
    ) => NotificationPolicyDecision | Promise<NotificationPolicyDecision>
  }
  observability: {
    onDispatch?: NotificationObservabilityHook
  }
  rules: NotificationRule[]
  events: NotificationEventRegistry
  eventsStrict: boolean
  data: {
    collections: DataCollectionAllowlist
    redact: string[]
    sensitiveFields: string[]
  }
  dataResolvers: Record<string, NotificationDataResolverDefinition>
  computed: Record<string, NotificationComputedDefinition>
  /** Code triggers: compiled `rules` followed by `triggers`. */
  triggers: NotificationTrigger[]
  recipients: {
    destinationFields: {
      email: string[]
      sms: string[]
      whatsapp: string[]
      name: string[]
      locale: string[]
      timezone: string[]
    }
    defaultCountryCode?: string
    roleField: string
    maxPerEvent: number
  }
  recipientResolvers: Record<string, NotificationRecipientResolverDefinition>
  recipientQueries: Record<string, NotificationRecipientQueryDefinition>
  conditions: Record<string, ConditionDefinition>
}
