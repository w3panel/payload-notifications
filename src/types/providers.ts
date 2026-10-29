import type { NotificationTemplateContext } from './templates'

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
