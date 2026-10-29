import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions, SMSProviderAdapter } from '../types'
import { customAsAdapter } from './customAdapter'
import { createTwilioSMSProvider } from './twilio-sms'

export const createSMSProvider = (
  options: NormalizedNotificationsPluginOptions,
  /** Passed to custom providers. */
  payload?: Payload,
): SMSProviderAdapter => {
  const custom = options.providers.custom?.sms
  if (custom) return customAsAdapter(custom, payload, 'sms', options)

  const provider = options.providers.sms?.provider

  if (provider === 'twilio') {
    return createTwilioSMSProvider(options)
  }

  throw new Error(`Unsupported SMS provider: ${String(provider)}. Supported providers: twilio`)
}
