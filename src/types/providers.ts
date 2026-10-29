import type { Payload } from 'payload'
import type { NotificationChannel } from './channels'
import type { NormalizedNotificationsPluginOptions } from './options'
import type { NotificationTemplateContext, RenderedNotificationContent } from './templates'

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
  /** Meta WhatsApp Business Account ID, for template approval status sync. */
  businessAccountId?: string
}

export type SMSProviderConfig = {
  provider: 'twilio'
  accountSid?: string
  authToken?: string
  from?: string
}

export type WhatsAppProviderSendInput = {
  to: string
  template: string
  context: NotificationTemplateContext
  /** Send this pre-approved template instead of free text. */
  whatsappTemplate?: { name: string; language: string; parameters: string[] }
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

/** What a provider can send. */
export type ProviderCapabilities = {
  html: boolean
  /** Pre-approved template messages (WhatsApp HSM). */
  hsm: boolean
  media: boolean
  /** Hard body length limit, if any. */
  maxLength?: number
}

export type ProviderSendInput = {
  /** Destination: email address, E.164 phone number, or user ID for in-app. */
  to: string
  channel: NotificationChannel
  content: RenderedNotificationContent
  /** Stable per delivery; providers that support idempotency keys should pass it on. */
  idempotencyKey?: string
  /** Extra headers (email), e.g. List-Unsubscribe. */
  headers?: Record<string, string>
  /** Aborted when the send times out. */
  signal: AbortSignal
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  meta?: Record<string, unknown>
}

export type ProviderSendResult = {
  status: 'sent' | 'accepted' | 'stored'
  providerMessageId?: string
  response?: Record<string, unknown>
}

/** A delivery status reported by a provider webhook or status lookup. */
export type ProviderStatusUpdate = {
  providerMessageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  error?: string
  errorCode?: string
  /** The destination should be suppressed (e.g. invalid number, unsubscribed). */
  suppress?: boolean
  occurredAt?: string
}

/** An inbound message (e.g. a STOP reply). */
export type ProviderInboundMessage = {
  channel: NotificationChannel
  from: string
  text?: string
  optOut: boolean
  /** A START / resubscribe reply: lifts an earlier STOP suppression. */
  optIn?: boolean
}

export type ProviderWebhookRequest = {
  method: string
  /** Public URL the provider called (used for signature checks). */
  url: string
  headers: Headers
  rawBody: string
  query: URLSearchParams
}

export type ProviderWebhookResult = {
  /** False when the signature check failed (respond 403). */
  verified: boolean
  /** Response to send instead of the default 200 (e.g. a verification challenge). */
  response?: { status: number; body: string; contentType?: string }
  updates: ProviderStatusUpdate[]
  inbound: ProviderInboundMessage[]
}

/** Provider interface v2: one implementation per channel provider. */
export type NotificationProvider = {
  name: string
  channels: NotificationChannel[]
  capabilities: ProviderCapabilities
  send: (input: ProviderSendInput) => Promise<ProviderSendResult>
  /** Configuration problems, checked at startup. */
  validateConfig?: () => string[]
  /** Parses (and verifies) a status / inbound webhook. */
  parseWebhook?: (request: ProviderWebhookRequest) => Promise<ProviderWebhookResult>
  /** Looks up a message's current status (used by reconciliation). */
  getStatus?: (providerMessageId: string) => Promise<ProviderStatusUpdate | undefined>
  /** Checks credentials / reachability for the admin's "Test connection". Must not send messages. */
  testConnection?: () => Promise<{ ok: boolean; message: string }>
}
