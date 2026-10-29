import type { PayloadRequest } from 'payload'
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
import type {
  CollectionEventConfig,
  NormalizedCollectionEventConfig,
  NotificationEventRegistry,
} from './events'
import type {
  NotificationPolicyContext,
  NotificationPolicyDecision,
  PreferenceFieldMapping,
} from './policy'
import type {
  EmailProviderConfig,
  NotificationProvider,
  SMSProviderConfig,
  WhatsAppProviderConfig,
} from './providers'
import type { NotificationTemplateRegistry } from './templates'
import type {
  NotificationRecipientQueryDefinition,
  NotificationRecipientResolverDefinition,
  NotificationRecipientsOptions,
} from './recipients'
import type {
  ConditionDefinition,
  ConditionHandler,
  NotificationRetryPolicy,
  NotificationRule,
  NotificationTrigger,
  NotificationTriggerInput,
} from './triggers'

export type NotificationsJobsOptions = {
  /** Named Payload jobs queue. Defaults to `notifications`. */
  queue?: string
}

/** Access check used for admin trigger management, publishing and test sends. */
export type NotificationAccessCheck = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export type NotificationsPluginOptions = {
  enabled?: boolean
  channels?: NotificationChannel[]
  userCollectionSlug?: string
  collections?: {
    notifications?: string
    logs?: string
    templates?: string
    deliveries?: string
    /** Admin-created triggers. */
    triggers?: string
    /** Published admin trigger snapshots. */
    triggerVersions?: string
    /** User preferences (with `preferences.mode: 'collection'`). */
    preferences?: string
    /** Suppressed destinations (bounces, STOP replies). */
    suppressions?: string
    /** Event inbox slug (only with `eventsInbox: true`). */
    events?: string
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
    /** Custom providers per channel; they replace the built-in provider for that channel. */
    custom?: Partial<Record<NotificationChannel, NotificationProvider>>
    /** Provider call timeout. A timed-out send has an unknown outcome and is not retried. Default 30000. */
    timeoutMs?: number
  }
  preferences?: {
    fields?: PreferenceFieldMapping
    /**
     * `userFields` (default): opt-outs come from fields on the user (`fields`).
     * `collection`: per user × channel × category records in `notification-preferences`.
     */
    mode?: 'userFields' | 'collection'
    /**
     * Categories that ignore opt-outs in collection mode (suppressions still
     * apply). `transactional` covers every non-marketing delivery. Default ['transactional'].
     */
    mandatoryCategories?: string[]
    /** Collection mode: marketing needs an explicit opt-in record. Default false. */
    marketingRequiresOptIn?: boolean
    /** Signed one-click unsubscribe links (collection mode). */
    unsubscribe?: {
      /** HMAC secret for unsubscribe tokens. */
      secret: string
      /** Public origin of the API, e.g. https://shop.example.com. Defaults to `serverURL`. */
      baseUrl?: string
    }
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
  /**
   * Collections whose changes emit `collection.<slug>.<operation>` events. Hooks
   * are added only to these collections, once, when the config is built.
   */
  collectionEvents?: Record<string, CollectionEventConfig>
  /**
   * Stop emitting events this many processing levels deep (e.g. a resolver that
   * writes to a hooked collection). Default 3.
   */
  maxEventDepth?: number
  /**
   * Hold back sends during these local hours (recipient timezone, else
   * `timezone`, else UTC). Applies to `marketing` deliveries by default.
   */
  quietHours?: {
    start: string
    end: string
    timezone?: string
    classifications?: Array<'transactional' | 'marketing'>
  }
  /**
   * Who may manage admin triggers, publish them and run test sends. Each
   * defaults to `isAdmin`, which defaults to "any logged-in user"; pass a role
   * check for real deployments.
   */
  access?: {
    isAdmin?: NotificationAccessCheck
    manageTriggers?: NotificationAccessCheck
    publishTriggers?: NotificationAccessCheck
    testSend?: NotificationAccessCheck
  }
  /** Admin-created triggers (`notification-triggers`). */
  adminTriggers?: {
    /** Cancel queued deliveries of a trigger when it is disabled or archived. Default false. */
    cancelQueuedOnDisable?: boolean
    /** How long published admin triggers are cached per instance. Default 30000 ms. */
    cacheTtlMs?: number
  }
  /** Default retry policy and limits for deliveries. */
  reliability?: NotificationRetryPolicy & {
    /** Upper bound for any trigger's `attempts`. Default 10. */
    maxAttempts?: number
    /** `sending` deliveries older than this are marked `unknown` by reconciliation. Default 30. */
    staleSendingMinutes?: number
  }
  /** Attempt log settings. */
  logs?: {
    /** Store rendered subject / text on attempt logs. Default false (may contain personal data). */
    storeRendered?: boolean
  }
  /** Provider webhooks (delivery status, STOP replies). */
  webhooks?: {
    /**
     * Public origin the providers call (e.g. https://shop.example.com) when the
     * server sits behind a proxy; Twilio signatures cover the full URL.
     */
    publicUrl?: string
    /** Defaults to the Twilio auth token in `providers.sms` / `providers.whatsapp`. */
    twilio?: { authToken?: string }
    meta?: { appSecret: string; verifyToken: string }
  }
  /** Scheduled maintenance tasks. */
  maintenance?: {
    /** Cron for `notification:reconcile` (stale / unknown deliveries). */
    reconcileCron?: string
    /** Cron for `notification:retention`. */
    retentionCron?: string
    /** Delete attempt logs, final deliveries and processed inbox events older than these. */
    retention?: { logsDays?: number; deliveriesDays?: number; eventsDays?: number }
  }
  /** Store every emitted event in `notification-events` for audit and replay. Default false. */
  eventsInbox?: boolean
  /** Multi-tenant scoping: lookups and role/query recipients stay within the event's tenant. */
  tenancy?: {
    /** Tenant field on documents (relationship or ID), e.g. `tenant`. */
    field: string
    /** Tenant field on users. Defaults to `field`. */
    userField?: string
  }
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
    events: string
    triggers: string
    triggerVersions: string
    preferences: string
    suppressions: string
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
    custom: Partial<Record<NotificationChannel, NotificationProvider>>
    timeoutMs: number
  }
  preferences: {
    fields: {
      channels: string
      marketingConsent: string
    }
    mode: 'userFields' | 'collection'
    mandatoryCategories: string[]
    marketingRequiresOptIn: boolean
    unsubscribe?: { secret: string; baseUrl?: string }
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
  collectionEvents: Record<string, NormalizedCollectionEventConfig>
  maxEventDepth: number
  eventsInbox: boolean
  reliability: {
    attempts: number
    backoff: { type: 'exponential' | 'fixed'; delayMs: number; maxDelayMs: number }
    jitter: boolean
    maxAttempts: number
    staleSendingMinutes: number
  }
  logs: { storeRendered: boolean }
  webhooks: {
    publicUrl?: string
    twilio?: { authToken?: string }
    meta?: { appSecret: string; verifyToken: string }
  }
  maintenance: {
    reconcileCron?: string
    retentionCron?: string
    retention: { logsDays?: number; deliveriesDays?: number; eventsDays?: number }
  }
  access: {
    manageTriggers: NotificationAccessCheck
    publishTriggers: NotificationAccessCheck
    testSend: NotificationAccessCheck
  }
  adminTriggers: {
    cancelQueuedOnDisable: boolean
    cacheTtlMs: number
  }
  tenancy?: { field: string; userField: string }
  quietHours?: {
    start: string
    end: string
    timezone: string
    classifications: Array<'transactional' | 'marketing'>
  }
}
