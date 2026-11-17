import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { isDuplicateKeyError } from '../data/errors'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { emitLifecycle } from '../observability'
import { claimDeliveryStatus } from './claim'
import { KEY_RELEASING_STATUSES, releaseDeliveryKey, sendOnceEventKey } from './keys'

/*
 * Standby deliveries (`deliveries.key: 'recipient'`).
 *
 * When a second route (another trigger or template) plans for an inbox whose send-once key
 * is held by a delivery that hasn't finished, the second delivery is stored as a standby:
 * status `skipped`, key `<key>::standby:<trigger>:<template>`, no send job. If the holder
 * then ends without sending (skipped, cancelled, failed), the oldest standby takes over the
 * key and is queued, so the recipient still gets one message. If the holder sends, the
 * standbys stay skipped.
 */

export const STANDBY_REASON_PREFIX = 'Standby:'

export const standbyKey = (idempotencyKey: string, trigger: string, template: string) =>
  `${idempotencyKey}::standby:${trigger}:${template}`

type StandbyDoc = {
  id: string | number
  status?: string
  idempotencyKey?: string
  trigger?: string
  templateSlug?: string
  event?: string
  eventId?: string
  channel?: string
  recipientId?: string | null
  recipientKey?: string | null
  classification?: string | null
  triggerOrigin?: string | null
  triggerVersion?: number | null
  scheduledFor?: string | null
  createdAt?: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/**
 * Called when a delivery ends without sending. If it held a send-once key and a standby
 * waits behind it, hands the key to the oldest standby and queues it. Never throws: a
 * failure here is logged and must not affect the delivery that just ended.
 */
export const promoteStandby = async ({
  payload,
  options,
  deliveryId,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  deliveryId: string
}): Promise<string | undefined> => {
  if (options.deliveries.key !== 'recipient') return undefined
  try {
    const holder = (await payload.findByID({
      collection: options.collections.deliveries as never,
      id: deliveryId,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
    })) as StandbyDoc | null
    const key = holder?.idempotencyKey
    if (!holder || !key || !holder.eventId || !sendOnceEventKey(key)) return undefined
    if (!holder.status || !KEY_RELEASING_STATUSES.has(holder.status)) return undefined

    // Standbys share the holder's event occurrence (indexed); match the key prefix here.
    const found = await payload.find({
      collection: options.collections.deliveries as never,
      where: {
        and: [
          { eventId: { equals: holder.eventId } },
          { channel: { equals: holder.channel } },
          { status: { equals: 'skipped' } },
        ],
      } as never,
      sort: 'createdAt',
      limit: 50,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    const prefix = `${key}::standby:`
    const standby = (found.docs as unknown as StandbyDoc[]).find((doc) =>
      text(doc.idempotencyKey)?.startsWith(prefix),
    )
    if (!standby?.trigger || !standby.templateSlug) return undefined

    const released = await releaseDeliveryKey({
      payload,
      options,
      holder: {
        id: String(holder.id),
        status: holder.status,
        trigger: holder.trigger,
        templateSlug: holder.templateSlug,
        event: holder.event,
        eventId: holder.eventId,
        channel: holder.channel,
        recipientKey: holder.recipientKey ?? undefined,
      },
      idempotencyKey: key,
      by: { trigger: standby.trigger, template: standby.templateSlug },
    })
    if (!released) return undefined

    const standbyId = String(standby.id)
    try {
      await payload.update({
        collection: options.collections.deliveries as never,
        id: standbyId,
        data: { idempotencyKey: key } as never,
        overrideAccess: true,
      })
    } catch (error) {
      // Another process promoted a standby (or re-planned) first: it holds the key now.
      if (isDuplicateKeyError(error)) return undefined
      throw error
    }
    const queued = await claimDeliveryStatus({
      payload,
      options,
      deliveryId: standbyId,
      from: 'skipped',
      to: 'queued',
      fields: { skipReason: null },
    })
    if (!queued) return undefined

    await payload.jobs.queue({
      overrideAccess: true,
      task: NOTIFICATION_SEND_TASK,
      queue: options.jobs.queue,
      input: {
        deliveryId: standbyId,
        userId: standby.recipientId ?? '',
        channel: standby.channel,
        template: standby.templateSlug,
        event: standby.event,
        eventId: standby.eventId,
      } as never,
      ...(standby.scheduledFor && Date.parse(standby.scheduledFor) > Date.now()
        ? { waitUntil: new Date(standby.scheduledFor) }
        : {}),
    })
    await emitLifecycle(payload, options, {
      stage: 'planned',
      event: standby.event,
      eventId: standby.eventId,
      trigger: standby.trigger,
      triggerSource:
        standby.triggerOrigin === 'admin' || standby.triggerOrigin === 'code'
          ? standby.triggerOrigin
          : undefined,
      triggerVersion: standby.triggerVersion ?? undefined,
      deliveryId: standbyId,
      channel: standby.channel as never,
      recipient: standby.recipientKey,
      reason: `Took over from delivery ${holder.id}, which ended ${holder.status} without sending`,
      idempotencyKey: key,
    })
    return standbyId
  } catch (error) {
    payload.logger?.error?.(
      { err: error },
      `payload-notifications: could not promote a standby for delivery ${deliveryId}`,
    )
    return undefined
  }
}
