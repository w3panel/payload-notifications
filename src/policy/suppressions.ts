import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions, NotificationChannel } from '../types'
import { normalizeEmail, normalizePhone } from '../recipients/resolve'

export type SuppressionReason = 'bounce' | 'complaint' | 'stop' | 'invalid' | 'manual'

/** Canonical form used for suppression matching. */
export const normalizeDestination = (
  channel: NotificationChannel,
  destination: string,
  defaultCountryCode?: string,
): string | undefined => {
  if (channel === 'email') return normalizeEmail(destination)
  if (channel === 'sms' || channel === 'whatsapp') {
    return normalizePhone(destination.replace(/^whatsapp:/, ''), defaultCountryCode)
  }
  return undefined
}

/** Suppression for a destination on a channel (a record without channel applies to all). */
export const findSuppression = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  channel: NotificationChannel,
  destination: string,
): Promise<{ id: string | number; reason?: string } | undefined> => {
  const normalized = normalizeDestination(
    channel,
    destination,
    options.recipients.defaultCountryCode,
  )
  if (!normalized) return undefined
  const result = await payload.find({
    collection: options.collections.suppressions as never,
    where: { destination: { equals: normalized } },
    limit: 10,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  return (
    result.docs as Array<{ id: string | number; channel?: string | null; reason?: string }>
  ).find((doc) => !doc.channel || doc.channel === channel)
}

/**
 * Adds a destination to the suppression list (idempotent). Use it for email
 * bounces / complaints from your mail provider; SMS / WhatsApp STOP replies and
 * invalid numbers are recorded by the webhooks.
 */
export const recordSuppression = async ({
  payload,
  options,
  channel,
  destination,
  reason,
  source,
  note,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  channel: NotificationChannel
  destination: string
  reason: SuppressionReason
  source?: string
  note?: string
}): Promise<boolean> => {
  const normalized = normalizeDestination(
    channel,
    destination,
    options.recipients.defaultCountryCode,
  )
  if (!normalized) return false
  if (await findSuppression(payload, options, channel, normalized)) return false
  await payload.create({
    collection: options.collections.suppressions as never,
    overrideAccess: true,
    data: { destination: normalized, channel, reason, source, note } as never,
  })
  return true
}
