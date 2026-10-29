import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationProvider,
  ProviderSendInput,
  ProviderSendResult,
} from '../types'
import { createMetaWhatsAppProvider } from './meta-whatsapp'
import { createTwilioSMSProvider } from './twilio-sms'
import { createTwilioWhatsAppProvider } from './twilio-whatsapp'

/** Payload's configured email adapter. */
export const payloadEmailProvider = (): NotificationProvider => ({
  name: 'payload-email',
  channels: ['email'],
  capabilities: { html: true, hsm: false, media: false },
  send: async ({ to, content, headers, payload, options }) => {
    await payload.sendEmail({
      to,
      subject: content.subject || 'Notification',
      html: content.html,
      text: content.text || content.body,
      from: options.providers.email?.defaultFromAddress,
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    })
    return { status: 'sent' }
  },
})

/** Stores the notification in the in-app inbox collection; `to` is the user ID. */
export const inAppProvider = (): NotificationProvider => ({
  name: 'payload-inapp',
  channels: ['inapp'],
  capabilities: { html: false, hsm: false, media: false },
  send: async ({ to, content, payload, options, meta }) => {
    const doc = (await payload.create({
      overrideAccess: true,
      collection: options.collections.notifications as never,
      data: {
        title: content.title || content.subject || 'Notification',
        message: content.body,
        recipient: to,
        meta: { data: meta?.eventPayload },
      } as never,
    })) as { id?: string | number }
    return {
      status: 'stored',
      providerMessageId: doc?.id !== undefined ? String(doc.id) : undefined,
    }
  },
})

/** Wraps a v1 text adapter (Twilio / Meta) as a v2 provider. */
const textAdapterProvider = (
  name: string,
  channel: 'sms' | 'whatsapp',
  maxLength: number | undefined,
  create: (options: NormalizedNotificationsPluginOptions) => {
    send: (input: { to: string; template: string; context: never }) => Promise<{
      provider: string
      messageId?: string
      response?: Record<string, unknown>
    }>
  },
): NotificationProvider => ({
  name,
  channels: [channel],
  capabilities: { html: false, hsm: false, media: false, maxLength },
  send: async ({ to, content, options }: ProviderSendInput): Promise<ProviderSendResult> => {
    const result = await create(options).send({
      to,
      template: content.body,
      context: {} as never,
    })
    return { status: 'sent', providerMessageId: result.messageId, response: result.response }
  },
})

/** The built-in provider for a channel, from `providers.<channel>` config. */
export const builtinProvider = (
  channel: NotificationChannel,
  options: NormalizedNotificationsPluginOptions,
): NotificationProvider | undefined => {
  switch (channel) {
    case 'email':
      return payloadEmailProvider()
    case 'inapp':
      return inAppProvider()
    case 'sms':
      return options.providers.sms?.provider === 'twilio'
        ? textAdapterProvider('twilio', 'sms', 1600, createTwilioSMSProvider)
        : undefined
    case 'whatsapp':
      if (options.providers.whatsapp?.provider === 'meta') {
        return textAdapterProvider('meta', 'whatsapp', 4096, createMetaWhatsAppProvider)
      }
      if (options.providers.whatsapp?.provider === 'twilio') {
        return textAdapterProvider('twilio', 'whatsapp', 1600, createTwilioWhatsAppProvider)
      }
      return undefined
    default:
      return undefined
  }
}

/** Custom provider for the channel if configured, else the built-in one. */
export const resolveProvider = (
  channel: NotificationChannel,
  options: NormalizedNotificationsPluginOptions,
): NotificationProvider | undefined =>
  options.providers.custom[channel] ?? builtinProvider(channel, options)
