import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDeliveryFallback,
  RecipientDestinations,
} from '../types'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { writeNotificationLog } from '../jobs/writeLog'
import { maskDestination } from '../recipients/resolve'

export type FallbackReason = 'permanent' | 'no-destination' | 'policy'

export const DEFAULT_FALLBACK_ON: FallbackReason[] = ['permanent', 'no-destination', 'policy']

/** The parts of a primary delivery a fallback copies. */
export type FallbackSource = {
  id: string | number
  event: string
  eventId?: string | null
  trigger: string
  triggerOrigin?: string | null
  triggerVersion?: number | null
  triggerPolicy?: string | null
  channel: string
  templateSlug: string
  recipientKey?: string | null
  recipientId?: string | null
  recipientAlias?: string | null
  classification?: string | null
  idempotencyKey: string
  dedupeKey?: string | null
  context?: unknown
  maxAttempts?: number | null
  retryPolicy?: unknown
  fallback?: NotificationDeliveryFallback | null
  recipientDestinations?: RecipientDestinations | null
}

const isDuplicateKeyError = (error: unknown) =>
  /duplicate|unique|already exists|E11000/i.test(
    error instanceof Error ? error.message : String(error),
  )

/**
 * Creates and queues the fallback delivery for `primary` when its fallback
 * covers `reason`. Never used for unknown outcomes. Returns the new delivery ID.
 */
export const createFallbackDelivery = async ({
  payload,
  options,
  primary,
  reason,
  detail,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  primary: FallbackSource
  reason: FallbackReason
  detail: string
}): Promise<string | undefined> => {
  const fallback = primary.fallback
  if (!fallback || !(fallback.on ?? DEFAULT_FALLBACK_ON).includes(reason)) return undefined
  if (!options.channels.includes(fallback.channel)) return undefined

  const destination =
    primary.recipientDestinations?.[fallback.channel as keyof RecipientDestinations] ?? undefined
  const idempotencyKey = `${primary.idempotencyKey}::fallback:${fallback.channel}`
  const template = fallback.template || primary.templateSlug

  if (!destination) {
    await writeNotificationLog({
      payload,
      options,
      input: {
        userId: primary.recipientId ?? '',
        event: primary.event,
        channel: fallback.channel,
        template,
        idempotencyKey,
      },
      status: 'skipped',
      error: `Fallback to ${fallback.channel} skipped: no ${fallback.channel} destination`,
      fingerprint: idempotencyKey,
      failureClassification: 'terminal',
      outcome: 'skipped',
    })
    return undefined
  }

  let created: { id: string | number }
  try {
    created = (await payload.create({
      collection: options.collections.deliveries as never,
      overrideAccess: true,
      data: {
        event: primary.event,
        eventId: primary.eventId,
        trigger: primary.trigger,
        triggerOrigin: primary.triggerOrigin,
        triggerVersion: primary.triggerVersion,
        triggerPolicy: primary.triggerPolicy,
        channel: fallback.channel,
        templateSlug: template,
        status: 'queued',
        attempts: 0,
        maxAttempts: primary.maxAttempts ?? 1,
        retryPolicy: primary.retryPolicy,
        recipientKey: primary.recipientKey,
        recipientId: primary.recipientId,
        recipientAlias: primary.recipientAlias,
        recipientDestinations: primary.recipientDestinations,
        destination,
        destinationMasked: maskDestination(destination),
        classification: primary.classification,
        idempotencyKey,
        dedupeKey: primary.dedupeKey,
        context: primary.context,
        fallbackOf: primary.id,
        skipReason: null,
        lastError: null,
      } as never,
    })) as { id: string | number }
  } catch (error) {
    if (isDuplicateKeyError(error)) return undefined
    throw error
  }

  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_SEND_TASK,
    queue: options.jobs.queue,
    input: {
      deliveryId: String(created.id),
      userId: primary.recipientId ?? '',
      channel: fallback.channel,
      template,
      event: primary.event,
      eventId: primary.eventId ?? undefined,
    },
  })
  payload.logger?.info?.(
    `payload-notifications: delivery ${primary.id} fell back to ${fallback.channel} (${reason}: ${detail})`,
  )
  return String(created.id)
}
