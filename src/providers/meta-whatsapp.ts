import type {
  ChannelProviderResult,
  NormalizedNotificationsPluginOptions,
  WhatsAppProviderAdapter,
  WhatsAppProviderSendInput,
} from '../types'

const META_GRAPH_API_VERSION = 'v25.0'
const META_GRAPH_API_BASE = 'https://graph.facebook.com'

type MetaWhatsAppMessageResponse = {
  messaging_product: string
  contacts?: Array<{ input: string; wa_id: string }>
  messages?: Array<{ id: string }>
  error?: {
    message: string
    type: string
    code: number
    fbtrace_id?: string
  }
}

const stripWhatsAppPrefix = (phone: string): string => {
  return phone.replace(/^whatsapp:/, '').replace(/[^+\d]/g, '')
}

export const createMetaWhatsAppProvider = (
  options: NormalizedNotificationsPluginOptions,
): WhatsAppProviderAdapter => {
  const config = options.providers.whatsapp
  const accessToken = config?.accessToken
  const phoneNumberId = config?.phoneNumberId

  if (!accessToken) {
    throw new Error('Meta WhatsApp Cloud API requires providers.whatsapp.accessToken')
  }

  if (!phoneNumberId) {
    throw new Error('Meta WhatsApp Cloud API requires providers.whatsapp.phoneNumberId')
  }

  return {
    send: async (input: WhatsAppProviderSendInput): Promise<ChannelProviderResult> => {
      const to = stripWhatsAppPrefix(input.to)
      const url = `${META_GRAPH_API_BASE}/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`

      const body = JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: input.template,
        },
      })

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      const data = (await response.json()) as MetaWhatsAppMessageResponse

      if (!response.ok || data.error) {
        const errorMessage = data.error?.message || `Meta WhatsApp API returned ${response.status}`
        throw new Error(errorMessage)
      }

      const messageId = data.messages?.[0]?.id
      const waId = data.contacts?.[0]?.wa_id

      return {
        provider: 'meta',
        messageId,
        response: {
          to: waId || to,
          messaging_product: data.messaging_product,
          httpStatus: response.status,
        },
      }
    },
  }
}
