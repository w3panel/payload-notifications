import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions, WhatsAppProviderAdapter } from '../types'
import { customAsAdapter } from './customAdapter'
import { createMetaWhatsAppProvider } from './meta-whatsapp'
import { createTwilioWhatsAppProvider } from './twilio-whatsapp'

export const createWhatsAppProvider = (
  options: NormalizedNotificationsPluginOptions,
  /** Passed to custom providers. */
  payload?: Payload,
): WhatsAppProviderAdapter => {
  const custom = options.providers.custom?.whatsapp
  if (custom) return customAsAdapter(custom, payload, 'whatsapp', options)

  const provider = options.providers.whatsapp?.provider

  if (provider === 'meta') {
    return createMetaWhatsAppProvider(options)
  }

  if (provider === 'twilio') {
    return createTwilioWhatsAppProvider(options)
  }

  throw new Error(
    `Unsupported WhatsApp provider: ${String(provider)}. Supported providers: meta, twilio`,
  )
}
