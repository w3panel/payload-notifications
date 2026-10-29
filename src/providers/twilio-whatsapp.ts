import type {
  ChannelProviderResult,
  NormalizedNotificationsPluginOptions,
  WhatsAppProviderAdapter,
  WhatsAppProviderSendInput,
} from '../types'
import { ProviderError } from './errors'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

type TwilioMessageResponse = {
  sid?: string
  status?: string
  to?: string
  from?: string
  error_code?: number
  error_message?: string
}

const ensureWhatsAppPrefix = (phone: string): string => {
  if (phone.startsWith('whatsapp:')) {
    return phone
  }
  return `whatsapp:${phone}`
}

export const createTwilioWhatsAppProvider = (
  options: NormalizedNotificationsPluginOptions,
): WhatsAppProviderAdapter => {
  const config = options.providers.whatsapp
  const accountSid = config?.accountSid
  const authToken = config?.authToken
  const from = config?.from

  if (!accountSid) {
    throw new Error('Twilio WhatsApp requires providers.whatsapp.accountSid')
  }

  if (!authToken) {
    throw new Error('Twilio WhatsApp requires providers.whatsapp.authToken')
  }

  if (!from) {
    throw new Error('Twilio WhatsApp requires providers.whatsapp.from')
  }

  return {
    send: async (input: WhatsAppProviderSendInput): Promise<ChannelProviderResult> => {
      const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`

      const hsm = input.whatsappTemplate
      const params = new URLSearchParams({
        To: ensureWhatsAppPrefix(input.to),
        From: ensureWhatsAppPrefix(from),
        // Approved templates go through Twilio's Content API (name = Content SID).
        ...(hsm
          ? {
              ContentSid: hsm.name,
              ContentVariables: JSON.stringify(
                Object.fromEntries(
                  hsm.parameters.map((value, index) => [String(index + 1), value]),
                ),
              ),
            }
          : { Body: input.template }),
      })

      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      const data = (await response.json()) as TwilioMessageResponse

      if (!response.ok || data.error_code) {
        const errorMessage = data.error_message || `Twilio WhatsApp API returned ${response.status}`
        throw new ProviderError(errorMessage, {
          status: response.ok ? 400 : response.status,
          code: data.error_code !== undefined ? String(data.error_code) : undefined,
        })
      }

      return {
        provider: 'twilio',
        messageId: data.sid,
        response: {
          to: data.to,
          from: data.from,
          status: data.status,
          httpStatus: response.status,
        },
      }
    },
  }
}
