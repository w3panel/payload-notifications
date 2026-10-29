import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { createSensitiveFieldMatcher, redactContext } from '../data/sensitive'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { emitLifecycle } from '../observability'
import { maskDestination } from '../recipients/resolve'
import { denyUnless } from './access'

type GetOptions = () => NormalizedNotificationsPluginOptions
type DeliveryDoc = Record<string, unknown> & {
  id: string | number
  status: string
  channel: string
  event: string
  eventId?: string | null
  trigger: string
  attempts?: number | null
  maxAttempts?: number | null
  recipientId?: string | null
  recipientKey?: string | null
  templateSlug?: string | null
  context?: Record<string, unknown> | null
}

/** Statuses an admin can retry; `unknown` may already have been delivered. */
export const RETRYABLE_STATUSES = new Set(['failed', 'unknown'])
/** Statuses an admin can cancel (not yet handed to a provider). */
export const CANCELLABLE_STATUSES = new Set(['planned', 'queued'])

export const deliveryActions = (delivery: Pick<DeliveryDoc, 'status'>) => ({
  canRetry: RETRYABLE_STATUSES.has(delivery.status),
  canCancel: CANCELLABLE_STATUSES.has(delivery.status),
  retryNeedsConfirmation: delivery.status === 'unknown',
})

/** Loads a delivery the caller may read (tenant scoping applies), or undefined. */
const readableDelivery = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  id: string,
) => {
  const visible = await req.payload.findByID({
    collection: options.collections.deliveries as never,
    id,
    depth: 0,
    overrideAccess: false,
    req,
    disableErrors: true,
  })
  if (!visible) return undefined
  // Server-only fields (context) are read after the access check.
  return (await req.payload.findByID({
    collection: options.collections.deliveries as never,
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as DeliveryDoc | null
}

/** The recipient's email and phone are shown masked, like the delivery's destination. */
const maskRecipient = (context: Record<string, unknown>): Record<string, unknown> => {
  const recipient = context.recipient
  if (!recipient || typeof recipient !== 'object') return context
  const masked = { ...(recipient as Record<string, unknown>) }
  for (const key of ['email', 'phone']) {
    if (typeof masked[key] === 'string') masked[key] = maskDestination(masked[key] as string)
  }
  return { ...context, recipient: masked }
}

/** Delivery details for the inspector: attempts, fallbacks and the redacted context. */
export const inspectDelivery = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  delivery: DeliveryDoc,
) => {
  const [attempts, fallbacks] = await Promise.all([
    payload.find({
      collection: options.collections.logs as never,
      where: { delivery: { equals: delivery.id } },
      sort: 'createdAt',
      limit: 100,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: options.collections.deliveries as never,
      where: { fallbackOf: { equals: delivery.id } },
      limit: 20,
      depth: 0,
      overrideAccess: true,
    }),
  ])
  const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)
  const { context, retryPolicy, templateOverrides, destination, recipientDestinations, ...rest } =
    delivery
  void retryPolicy
  void templateOverrides
  void destination
  void recipientDestinations
  return {
    delivery: rest,
    context: context
      ? maskRecipient(redactContext(context, options.data.redact, isSensitive))
      : null,
    attempts: (attempts.docs as Array<Record<string, unknown>>).map((log) => ({
      id: log.id,
      at: log.createdAt,
      attempt: log.attempt,
      status: log.status,
      outcome: log.outcome,
      error: log.error,
      durationMs: log.durationMs,
      failureClassification: log.failureClassification,
      provider: (log.providerResponse as { provider?: unknown } | undefined)?.provider,
      providerMessageId: (log.providerResponse as { messageID?: unknown } | undefined)?.messageID,
      providerResponse: redactContext(
        (log.providerResponse as { raw?: unknown } | undefined)?.raw ?? null,
        options.data.redact,
        isSensitive,
      ),
    })),
    fallbacks: (fallbacks.docs as DeliveryDoc[]).map((doc) => ({
      id: doc.id,
      channel: doc.channel,
      status: doc.status,
    })),
    actions: deliveryActions(delivery),
  }
}

/** Re-queues a failed (or, when confirmed, unknown) delivery on the same record and idempotency key. */
export const retryDelivery = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  delivery: DeliveryDoc,
  { confirmUnknown = false }: { confirmUnknown?: boolean } = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  if (!RETRYABLE_STATUSES.has(delivery.status)) {
    return { ok: false, status: 409, error: `A ${delivery.status} delivery cannot be retried` }
  }
  if (delivery.status === 'unknown' && !confirmUnknown) {
    return {
      ok: false,
      status: 409,
      error:
        'The outcome is unknown and the message may already have been delivered; confirm to retry',
    }
  }
  const attempts = delivery.attempts ?? 0
  await payload.update({
    collection: options.collections.deliveries as never,
    id: delivery.id,
    data: {
      status: 'queued',
      // One more attempt than already made, so the send job runs again.
      maxAttempts: Math.max(delivery.maxAttempts ?? 1, attempts + 1),
      nextAttemptAt: null,
    } as never,
    overrideAccess: true,
  })
  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_SEND_TASK,
    queue: options.jobs.queue,
    input: {
      deliveryId: String(delivery.id),
      userId: delivery.recipientId ?? '',
      channel: delivery.channel,
      template: delivery.templateSlug ?? '',
      event: delivery.event,
      eventId: delivery.eventId ?? undefined,
    },
  } as never)
  await emitLifecycle(payload, options, {
    stage: 'retrying',
    event: delivery.event,
    eventId: delivery.eventId ?? undefined,
    trigger: delivery.trigger,
    deliveryId: String(delivery.id),
    channel: delivery.channel as never,
    recipient: delivery.recipientKey,
    reason: 'Retried from the admin',
  })
  return { ok: true }
}

/** Cancels a planned or queued delivery; its send job then skips it. */
export const cancelDelivery = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  delivery: DeliveryDoc,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  if (!CANCELLABLE_STATUSES.has(delivery.status)) {
    return { ok: false, status: 409, error: `A ${delivery.status} delivery cannot be cancelled` }
  }
  await payload.update({
    collection: options.collections.deliveries as never,
    id: delivery.id,
    data: { status: 'cancelled', skipReason: 'Cancelled from the admin' } as never,
    overrideAccess: true,
  })
  await emitLifecycle(payload, options, {
    stage: 'cancelled',
    event: delivery.event,
    eventId: delivery.eventId ?? undefined,
    trigger: delivery.trigger,
    deliveryId: String(delivery.id),
    channel: delivery.channel as never,
    recipient: delivery.recipientKey,
    reason: 'Cancelled from the admin',
  })
  return { ok: true }
}

const idOf = (req: PayloadRequest) => String(req.routeParams?.id ?? '')

/**
 * Deliveries collection endpoints: `GET /:id/inspect` (viewDeliveries),
 * `POST /:id/retry { confirmUnknown? }` and `POST /:id/cancel` (retryDeliveries).
 */
export const deliveryEndpoints = (getOptions: GetOptions): Endpoint[] => {
  const load = async (req: PayloadRequest, write: boolean) => {
    const options = getOptions()
    const denied = await denyUnless(
      req,
      write ? options.access.retryDeliveries : options.access.viewDeliveries,
    )
    if (denied) return { denied }
    const delivery = await readableDelivery(req, options, idOf(req))
    if (!delivery)
      return { denied: Response.json({ error: 'Delivery not found' }, { status: 404 }) }
    return { options, delivery }
  }
  const reply = (result: { ok: true } | { ok: false; status: number; error: string }) =>
    result.ok
      ? Response.json({ ok: true })
      : Response.json({ ok: false, error: result.error }, { status: result.status })

  return [
    {
      path: '/:id/inspect',
      method: 'get',
      handler: async (req) => {
        const loaded = await load(req, false)
        if (loaded.denied) return loaded.denied
        return Response.json(await inspectDelivery(req.payload, loaded.options, loaded.delivery))
      },
    },
    {
      path: '/:id/retry',
      method: 'post',
      handler: async (req) => {
        const loaded = await load(req, true)
        if (loaded.denied) return loaded.denied
        const body = ((await req.json?.().catch(() => ({}))) ?? {}) as { confirmUnknown?: boolean }
        return reply(
          await retryDelivery(req.payload, loaded.options, loaded.delivery, {
            confirmUnknown: body.confirmUnknown === true,
          }),
        )
      },
    },
    {
      path: '/:id/cancel',
      method: 'post',
      handler: async (req) => {
        const loaded = await load(req, true)
        if (loaded.denied) return loaded.denied
        return reply(await cancelDelivery(req.payload, loaded.options, loaded.delivery))
      },
    },
  ]
}
