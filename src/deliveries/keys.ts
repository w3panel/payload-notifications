import { normalizeEmail, normalizePhone } from '../recipients/resolve'

/*
 * Send-once delivery keys (`deliveries.key: 'recipient'`). The default key is
 * `buildDeliveryKey` in `./plan`.
 */

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

const PHONE_CHANNELS = new Set(['sms', 'whatsapp'])

/**
 * Who a delivery reaches, for the send-once key. Email, WhatsApp and SMS: the
 * normalised address or number, hashed (`email#…`, `phone#…`), so one inbox
 * reached as an account and as a static address is one recipient and the key
 * carries no address. Other channels, or no destination: the account
 * (`user#<id>`), else the recipient key (hashed, `key#…`).
 */
export const deliveryRecipientIdentity = async ({
  channel,
  destination,
  recipientId,
  recipientKey,
}: {
  channel: string
  destination?: string | null
  recipientId?: string | null
  recipientKey?: string | null
}): Promise<string> => {
  const address = destination?.trim()
  if (address && channel === 'email') {
    return `email#${await sha256Hex(normalizeEmail(address) ?? address.toLowerCase())}`
  }
  if (address && PHONE_CHANNELS.has(channel)) {
    const phone = normalizePhone(address) ?? address.replace(/[\s\-().]/g, '')
    return `phone#${await sha256Hex(phone)}`
  }
  if (recipientId) return `user#${encodeURIComponent(recipientId)}`
  return `key#${await sha256Hex(recipientKey || 'unknown')}`
}

/**
 * Send-once delivery key (`deliveries.key: 'recipient'`): event key + channel +
 * recipient identity, `<eventKey>::<channel>::<identity>`. Unique like every
 * idempotency key, so one recipient gets at most one delivery per event and channel.
 */
export const buildSendOnceKey = async ({
  eventKey,
  channel,
  destination,
  recipientId,
  recipientKey,
}: {
  /** The event's `idempotencyKey`, else its `eventId`. */
  eventKey: string
  channel: string
  destination?: string | null
  recipientId?: string | null
  recipientKey?: string | null
}): Promise<string> =>
  [
    eventKey,
    channel,
    await deliveryRecipientIdentity({ channel, destination, recipientId, recipientKey }),
  ].join('::')

const SEND_ONCE_KEY = /^(.*)::[a-z]+::(?:email|phone|user|key)#[^:]+$/

/** The event key of a send-once key, or undefined for any other key. */
export const sendOnceEventKey = (idempotencyKey: string): string | undefined =>
  SEND_ONCE_KEY.exec(idempotencyKey)?.[1] || undefined
