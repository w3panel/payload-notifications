export type NotificationChannel = 'email' | 'whatsapp' | 'sms' | 'inapp' | 'push'

export type NotificationClassification = 'transactional' | 'marketing'

export type NotificationEventPayload = Record<string, unknown>

export type NotificationTemplateContext = {
  event: string
  userId: string
  payload?: NotificationEventPayload
}

export type NotificationTemplateDefinition = {
  subject?: string
  title?: string
  /** Plain-text / SMS / WhatsApp / in-app body (also email text fallback). */
  body: string
  /** Email HTML source; when set, used for `html` output instead of escaping `body`. */
  htmlBody?: string
  /** Explicit email text body (preferred over `body` for email text when present). */
  textBody?: string
}

export type NotificationTemplateSet = Partial<
  Record<NotificationChannel, string | NotificationTemplateDefinition>
>

export type NotificationTemplateRegistry = Record<string, NotificationTemplateSet>

export type NotificationEvent = {
  name: string
  userId?: string
  payload?: NotificationEventPayload
  classification?: NotificationClassification
  idempotencyKey?: string
}

export type NotificationRule = {
  event: string
  channels: NotificationChannel[]
  template: string
  enabled?: boolean
  condition?: (payload: NotificationEventPayload) => boolean | Promise<boolean>
  templateOverrides?: Partial<Record<NotificationChannel, Partial<NotificationTemplateDefinition>>>
}

export type NotificationTriggerDefinition = NotificationRule

export type PreferenceFieldMapping = {
  channels?: string
  marketingConsent?: string
}

export type NotificationPolicyDecision = {
  allow: boolean
  reason?: string
}

export type NotificationPolicyContext = {
  channel: NotificationChannel
  event: string
  classification?: NotificationClassification
  user: Record<string, unknown>
  payload?: NotificationEventPayload
}

export type DispatchFailureClassification = 'retriable' | 'terminal'

export type DispatchFailureInfo = {
  classification: DispatchFailureClassification
  message: string
}

export type ObservabilityEvent = {
  type: 'notification.dispatch'
  channel: NotificationChannel
  event: string
  userId: string
  status: NotificationDispatchStatus
  reason?: string
  provider?: string
  providerMessageId?: string
  idempotencyKey?: string
  fingerprint?: string
  attempt?: number
  classification?: DispatchFailureClassification
}

export type NotificationObservabilityHook = (event: ObservabilityEvent) => void | Promise<void>

export type EmailProviderConfig = {
  adapter?: unknown
  defaultFromName?: string
  defaultFromAddress?: string
}

export type WhatsAppProviderConfig = {
  provider: 'twilio' | 'meta'
  accountSid?: string
  authToken?: string
  from?: string
  accessToken?: string
  phoneNumberId?: string
}

export type SMSProviderConfig = {
  provider: 'twilio'
  accountSid?: string
  authToken?: string
  from?: string
}

export type RenderedTemplate = {
  subject?: string
  htmlBody?: string
  textBody?: string
  body?: string
  title?: string
  hsmTemplateId?: string
  hsmParams?: Record<string, string>
  metadata?: {
    smsSegments?: number
    smsCharCount?: number
    templateSlug?: string
    templateVersion?: number
    renderDurationMs?: number
  }
}

export type NotificationTemplateRecord = {
  id: string
  name: string
  slug: string
  description?: string
  channels: NotificationChannel[]
  category: 'transactional' | 'marketing' | 'system'
  status: 'draft' | 'active' | 'archived'
  version: number
  email?: { subject?: string; htmlBody?: string; textBody?: string }
  sms?: { body?: string }
  whatsapp?: { body?: string; hsmTemplateId?: string }
  inapp?: { title?: string; body?: string }
  variables?: Array<{
    name: string
    type: 'string' | 'number' | 'boolean' | 'date'
    required: boolean
    defaultValue?: string
  }>
}

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
}

export type NormalizedNotificationsPluginOptions = {
  enabled: boolean
  channels: NotificationChannel[]
  userCollectionSlug: string
  collections: {
    notifications: string
    logs: string
    templates: string
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
}

export type RenderedNotificationContent = {
  subject?: string
  title?: string
  body: string
  text: string
  html: string
}

export type NotificationSendInput = {
  userId: string
  channel: NotificationChannel
  template: string
  event: string
  eventPayload?: NotificationEventPayload
  classification?: NotificationClassification
  idempotencyKey?: string
  /** @deprecated Payload job retries replace custom attempt tracking */
  attempt?: number
  templateOverrides?: Partial<NotificationTemplateDefinition>
  /** Optional Payload job id for log correlation */
  jobId?: string | number
}

export type NotificationDispatchStatus = 'queued' | 'sent' | 'stored' | 'failed' | 'skipped'

export type NotificationDispatchResult = {
  channel: NotificationChannel
  status: NotificationDispatchStatus
  reason?: string
  provider?: string
  providerMessageId?: string
  response?: Record<string, unknown>
}

export type NotificationQueueTask = {
  slug: 'notification:process-event' | 'notification:send'
}

export type NotificationProcessEventJobInput = NotificationEvent

export type NotificationSendJobInput = NotificationSendInput

export type NotificationTemplateRenderer = (
  template: string,
  context: NotificationTemplateContext,
) => Promise<{
  subject?: string
  text?: string
  html?: string
  meta?: Record<string, unknown>
}>

export type NotificationTemplateResolution = {
  event: string
  channel: NotificationChannel
  templateKey: string
  definition: NotificationTemplateDefinition
  templateSlug?: string
  templateVersion?: number
}

export type NotificationTemplateResolver = (input: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
}) => NotificationTemplateResolution

export type WhatsAppProviderSendInput = {
  to: string
  template: string
  context: NotificationTemplateContext
}

export type SMSProviderSendInput = {
  to: string
  template: string
  context: NotificationTemplateContext
}

export type ChannelProviderResult = {
  provider: string
  messageId?: string
  response?: Record<string, unknown>
}

export type WhatsAppProviderAdapter = {
  send: (input: WhatsAppProviderSendInput) => Promise<ChannelProviderResult>
}

export type SMSProviderAdapter = {
  send: (input: SMSProviderSendInput) => Promise<ChannelProviderResult>
}
