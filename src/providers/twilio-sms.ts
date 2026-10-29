import type {
  ChannelProviderResult,
  NormalizedNotificationsPluginOptions,
  SMSProviderAdapter,
  SMSProviderSendInput,
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

export const createTwilioSMSProvider = (
  options: NormalizedNotificationsPluginOptions,
): SMSProviderAdapter => {
  const config = options.providers.sms
  const accountSid = config?.accountSid
  const authToken = config?.authToken
  const from = config?.from

  if (!accountSid) {
    throw new Error('Twilio SMS requires providers.sms.accountSid')
  }

  if (!authToken) {
    throw new Error('Twilio SMS requires providers.sms.authToken')
  }

  if (!from) {
    throw new Error('Twilio SMS requires providers.sms.from')
  }

  return {
    send: async (input: SMSProviderSendInput): Promise<ChannelProviderResult> => {
      const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`

      const params = new URLSearchParams({
        To: input.to,
        From: from,
        Body: input.template,
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
        const errorMessage = data.error_message || `Twilio API returned ${response.status}`
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
