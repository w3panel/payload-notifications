import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  ProviderStatusUpdate,
  ProviderWebhookResult,
} from '../types'
import { createFallbackDelivery, type FallbackSource } from '../deliveries/fallback'
import { emitLifecycle } from '../observability'
import { normalizeDestination, recordSuppression } from '../policy/suppressions'

type DeliveryDoc = FallbackSource & {
  status: string
  destination?: string | null
  deliveredAt?: string | null
}

export type WebhookApplyResult = { updated: number; suppressed: number; unmatched: number }

/** Applies one provider status update to the delivery with that provider message ID. */
export const applyStatusUpdate = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  update: ProviderStatusUpdate,
  channel?: NotificationChannel,
): Promise<'updated' | 'unmatched' | 'ignored'> => {
  const found = await payload.find({
    collection: options.collections.deliveries as never,
    where: {
      and: [
        { providerMessageId: { equals: update.providerMessageId } },
        ...(channel ? [{ channel: { equals: channel } }] : []),
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const delivery = found.docs?.[0] as unknown as DeliveryDoc | undefined
  if (!delivery) return 'unmatched'

  const previousStatus = delivery.status
  const now = update.occurredAt ?? new Date().toISOString()
  let data: Record<string, unknown> | undefined
  switch (update.status) {
    case 'sent':
      // Resolves an ambiguous (timed-out) send.
      if (delivery.status === 'unknown' || delivery.status === 'sending') {
        data = { status: 'sent', sentAt: now, lastError: null }
      }
      break
    case 'delivered':
      if (delivery.status !== 'failed') data = { status: 'delivered', deliveredAt: now }
      break
    case 'read':
      data = {
        status: 'delivered',
        readAt: now,
        ...(delivery.deliveredAt ? {} : { deliveredAt: now }),
      }
      break
    case 'failed':
      if (delivery.status !== 'failed') {
        data = { status: 'failed', lastError: update.error ?? 'Provider reported delivery failure' }
      }
      break
  }

  if (update.suppress && delivery.destination) {
    await recordSuppression({
      payload,
      options,
      channel: delivery.channel as NotificationChannel,
      destination: delivery.destination,
      reason: update.errorCode === '21610' ? 'stop' : 'invalid',
      source: 'provider-webhook',
      note: update.error,
    })
  }
  if (!data) return 'ignored'

  await payload.update({
    collection: options.collections.deliveries as never,
    id: delivery.id,
    data: data as never,
    overrideAccess: true,
  })
  await emitLifecycle(payload, options, {
    stage: update.status === 'read' ? 'delivered' : update.status,
    event: delivery.event,
    eventId: delivery.eventId ?? undefined,
    trigger: delivery.trigger,
    deliveryId: String(delivery.id),
    channel: delivery.channel as NotificationChannel,
    recipient: delivery.recipientKey,
    reason: update.error,
    providerMessageId: update.providerMessageId,
  })
  if (update.status === 'failed' && previousStatus !== 'failed') {
    await createFallbackDelivery({
      payload,
      options,
      primary: delivery,
      reason: 'permanent',
      detail: update.error ?? 'provider reported failure',
    })
  }
  return 'updated'
}

/** Applies a parsed webhook: status updates and STOP / START replies. */
export const applyWebhookResult = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  result: ProviderWebhookResult,
  channel?: NotificationChannel,
): Promise<WebhookApplyResult> => {
  const summary: WebhookApplyResult = { updated: 0, suppressed: 0, unmatched: 0 }
  for (const update of result.updates) {
    const outcome = await applyStatusUpdate(payload, options, update, channel)
    if (outcome === 'updated') summary.updated++
    if (outcome === 'unmatched') summary.unmatched++
  }
  for (const message of result.inbound) {
    if (message.optOut) {
      const added = await recordSuppression({
        payload,
        options,
        channel: message.channel,
        destination: message.from,
        reason: 'stop',
        source: 'inbound-reply',
        note: message.text,
      })
      if (added) summary.suppressed++
    } else if (message.optIn) {
      const destination = normalizeDestination(
        message.channel,
        message.from,
        options.recipients.defaultCountryCode,
      )
      if (destination) {
        await payload.delete({
          collection: options.collections.suppressions as never,
          where: {
            and: [{ destination: { equals: destination } }, { reason: { equals: 'stop' } }],
          },
          overrideAccess: true,
        })
      }
    }
  }
  return summary
}
