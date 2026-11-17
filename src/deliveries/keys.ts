import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { emitLifecycle } from '../observability'
import { normalizeEmail, normalizePhone } from '../recipients/resolve'
import { claimDeliveryStatus } from './claim'

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

/** The delivery holding an idempotency key. */
export type DeliveryKeyHolder = {
  id: string
  status?: string
  trigger?: string
  templateSlug?: string
  event?: string
  eventId?: string
  channel?: string
  recipientKey?: string
}

/** The delivery holding an idempotency key, if any. */
export const findDeliveryByKey = async (
  payload: Payload,
  options: Pick<NormalizedNotificationsPluginOptions, 'collections'>,
  idempotencyKey: string,
): Promise<DeliveryKeyHolder | undefined> => {
  const existing = await payload.find({
    collection: options.collections.deliveries as never,
    where: { idempotencyKey: { equals: idempotencyKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const doc = existing.docs?.[0] as Record<string, unknown> | undefined
  if (!doc) return undefined
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return {
    id: String(doc.id),
    status: text(doc.status),
    trigger: text(doc.trigger),
    templateSlug: text(doc.templateSlug),
    event: text(doc.event),
    eventId: text(doc.eventId),
    channel: text(doc.channel),
    recipientKey: text(doc.recipientKey),
  }
}

/**
 * Statuses that end a delivery with nothing sent. A send-once key held by such a delivery
 * can be handed on to another trigger's delivery. `unknown` is not one: the provider may
 * have delivered it.
 */
export const KEY_RELEASING_STATUSES = new Set(['skipped', 'cancelled', 'failed'])

/**
 * Hands a send-once key on when its holder ended without sending (skipped by policy,
 * cancelled or vetoed, failed) and belongs to another trigger or template than `by`.
 * Replays of the same route keep finding the holder, as before.
 *
 * A failed holder is cancelled first (compare-and-set), so an admin retry can't also send
 * it. The holder's key is then renamed `<key>::superseded:<id>`, freeing the original.
 * Returns true when the key is free for `by`.
 */
export const releaseDeliveryKey = async ({
  payload,
  options,
  holder,
  idempotencyKey,
  by,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  holder: DeliveryKeyHolder
  idempotencyKey: string
  by: { trigger: string; template: string }
}): Promise<boolean> => {
  if (!holder.status || !KEY_RELEASING_STATUSES.has(holder.status)) return false
  if (holder.trigger === by.trigger && holder.templateSlug === by.template) return false
  const reason = `Superseded: trigger "${by.trigger}" took over its send-once key`
  if (holder.status === 'failed') {
    const cancelled = await claimDeliveryStatus({
      payload,
      options,
      deliveryId: holder.id,
      from: 'failed',
      to: 'cancelled',
      fields: { skipReason: reason },
    })
    if (!cancelled) return false
    await emitLifecycle(payload, options, {
      stage: 'cancelled',
      event: holder.event,
      eventId: holder.eventId,
      trigger: holder.trigger,
      deliveryId: holder.id,
      channel: holder.channel as never,
      recipient: holder.recipientKey,
      reason,
      idempotencyKey,
    })
  }
  await payload.update({
    collection: options.collections.deliveries as never,
    id: holder.id,
    data: { idempotencyKey: `${idempotencyKey}::superseded:${holder.id}` } as never,
    overrideAccess: true,
  })
  return true
}
