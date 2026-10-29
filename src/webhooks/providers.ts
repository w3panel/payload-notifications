import type {
  NotificationChannel,
  ProviderStatusUpdate,
  ProviderWebhookRequest,
  ProviderWebhookResult,
} from '../types'
import { verifyMetaSignature, verifyTwilioSignature } from './signatures'

const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out)\s*$/i
const START_WORDS = /^\s*(start|unstop|yes|subscribe)\s*$/i

/** Twilio error codes meaning the destination must not be messaged again. */
const TWILIO_SUPPRESS = new Map([
  ['21610', 'stop'],
  ['21211', 'invalid'],
  ['21614', 'invalid'],
  ['63003', 'invalid'],
])

const empty = (verified: boolean): ProviderWebhookResult => ({ verified, updates: [], inbound: [] })

/**
 * Parses a Twilio status callback or inbound message (form-encoded) after
 * checking `X-Twilio-Signature` against the public URL.
 */
export const parseTwilioWebhook = async (
  request: ProviderWebhookRequest,
  authToken: string,
): Promise<ProviderWebhookResult> => {
  const params = new URLSearchParams(request.rawBody)
  const verified = await verifyTwilioSignature(
    authToken,
    request.url,
    params,
    request.headers.get('x-twilio-signature'),
  )
  if (!verified) return empty(false)

  const result = empty(true)
  const from = params.get('From') ?? ''
  const channel: NotificationChannel = from.startsWith('whatsapp:') ? 'whatsapp' : 'sms'
  const sid = params.get('MessageSid') ?? params.get('SmsSid')
  const status = params.get('MessageStatus') ?? params.get('SmsStatus')
  const body = params.get('Body')

  if (body !== null && from) {
    // Inbound message: STOP / START keywords (Twilio also sets OptOutType).
    const optOutType = params.get('OptOutType')?.toUpperCase()
    const optOut = optOutType === 'STOP' || (!optOutType && STOP_WORDS.test(body))
    const optIn = optOutType === 'START' || (!optOutType && START_WORDS.test(body))
    if (optOut || optIn) {
      result.inbound.push({ channel, from, text: body, optOut, optIn })
    }
    return result
  }

  if (sid && status) {
    const errorCode = params.get('ErrorCode') ?? undefined
    const mapped: ProviderStatusUpdate['status'] | undefined =
      status === 'delivered'
        ? 'delivered'
        : status === 'read'
          ? 'read'
          : status === 'failed' || status === 'undelivered'
            ? 'failed'
            : status === 'sent'
              ? 'sent'
              : undefined
    if (mapped) {
      result.updates.push({
        providerMessageId: sid,
        status: mapped,
        ...(errorCode ? { errorCode, error: `Twilio error ${errorCode}` } : {}),
        ...(errorCode && TWILIO_SUPPRESS.has(errorCode) ? { suppress: true } : {}),
      })
    }
  }
  return result
}

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id: string
          status: string
          recipient_id?: string
          errors?: Array<{ code?: number; title?: string; message?: string }>
        }>
        messages?: Array<{ from: string; type?: string; text?: { body?: string } }>
      }
    }>
  }>
}

/**
 * Parses a Meta WhatsApp Cloud API webhook: answers the GET verification
 * handshake and checks `X-Hub-Signature-256` on notifications.
 */
export const parseMetaWebhook = async (
  request: ProviderWebhookRequest,
  { appSecret, verifyToken }: { appSecret: string; verifyToken: string },
): Promise<ProviderWebhookResult> => {
  if (request.method.toUpperCase() === 'GET') {
    const mode = request.query.get('hub.mode')
    const token = request.query.get('hub.verify_token')
    const challenge = request.query.get('hub.challenge') ?? ''
    const ok = mode === 'subscribe' && token === verifyToken
    return {
      verified: ok,
      updates: [],
      inbound: [],
      response: ok ? { status: 200, body: challenge, contentType: 'text/plain' } : undefined,
    }
  }

  const verified = await verifyMetaSignature(
    appSecret,
    request.rawBody,
    request.headers.get('x-hub-signature-256'),
  )
  if (!verified) return empty(false)

  const result = empty(true)
  let body: MetaPayload
  try {
    body = JSON.parse(request.rawBody) as MetaPayload
  } catch {
    return result
  }
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        const mapped = (['sent', 'delivered', 'read', 'failed'] as const).find(
          (s) => s === status.status,
        )
        if (!mapped) continue
        const error = status.errors?.[0]
        result.updates.push({
          providerMessageId: status.id,
          status: mapped,
          ...(error
            ? {
                errorCode: String(error.code ?? ''),
                error: error.title || error.message || 'Meta error',
              }
            : {}),
        })
      }
      for (const message of change.value?.messages ?? []) {
        const text = message.text?.body ?? ''
        const from = message.from.startsWith('+') ? message.from : `+${message.from}`
        if (STOP_WORDS.test(text) || START_WORDS.test(text)) {
          result.inbound.push({
            channel: 'whatsapp',
            from,
            text,
            optOut: STOP_WORDS.test(text),
            optIn: START_WORDS.test(text),
          })
        }
      }
    }
  }
  return result
}
