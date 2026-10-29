import type { NotificationChannel } from './channels'
import type { NotificationTriggerInfo } from './data-sources'
import type { NotificationEventPayload } from './events'
import type { NormalizedNotificationsPluginOptions } from './options'

export type NotificationTemplateContext = {
  /** Event name, e.g. `order.paid`. */
  event: string
  userId: string
  payload?: NotificationEventPayload
  /** Occurrence metadata (`trigger.name`, `trigger.eventId`, …) when built by the data context builder. */
  trigger?: NotificationTriggerInfo
  /** Data source aliases (`order`, `customer`, …) and `doc` / `previous`. */
  [key: string]: unknown
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
  /** Email preview text shown next to the subject in inboxes. */
  preheader?: string
  /** In-app: link opened when the notification is clicked (template allowed). */
  actionUrl?: string
  /** In-app: icon name or URL. */
  icon?: string
  /** In-app priority. */
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  /** WhatsApp: pre-approved template (HSM) to send instead of free text. */
  whatsappTemplate?: WhatsAppTemplateDefinition
}

export type WhatsAppTemplateDefinition = {
  /** Approved template name (Meta) or Content SID (Twilio). */
  name: string
  /** Template language code, e.g. `en_US`. Default `en`. */
  language?: string
  /** Body parameters in order ({{1}}, {{2}} …); each is a template string. */
  parameters?: string[]
  /** Approval status last synced from the provider (APPROVED, PENDING, REJECTED …). */
  status?: string
}

export type NotificationTemplateSet = Partial<
  Record<NotificationChannel, string | NotificationTemplateDefinition>
>

export type NotificationTemplateRegistry = Record<string, NotificationTemplateSet>

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

export type RenderedNotificationContent = {
  subject?: string
  title?: string
  body: string
  text: string
  html: string
  preheader?: string
  actionUrl?: string
  icon?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  /** Rendered WhatsApp template (name, language, parameter values). */
  whatsappTemplate?: { name: string; language: string; parameters: string[]; status?: string }
  /** SMS / WhatsApp text sizing. */
  segments?: SmsSegmentInfo
}

export type SmsSegmentInfo = {
  encoding: 'GSM-7' | 'UCS-2'
  /** Billable characters (GSM-7 extension characters count twice). */
  characters: number
  segments: number
}

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
  /** Locale of the template that matched ('' = no locale). */
  templateLocale?: string
}

export type NotificationTemplateResolver = (input: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
}) => NotificationTemplateResolution
