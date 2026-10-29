import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
} from '../types'
import { dispatchToChannel } from '../channels/dispatch'
import { writeNotificationLog } from '../jobs/writeLog'
import { evaluateNotificationPolicy } from '../policy/evaluatePolicy'
import { classifyDispatchFailure, createObservabilityEvent } from '../reliability'
import { mergeTemplateDefinition, renderDefinition } from '../templates/renderDefinition'
import { resolveTemplate } from '../templates/resolve'

/** Statuses after which a delivery is never sent again by the send job. */
export const FINAL_DELIVERY_STATUSES = new Set([
  'sent',
  'delivered',
  'failed',
  'skipped',
  'cancelled',
])

type DeliveryDoc = {
  id: string | number
  event: string
  eventId?: string
  channel: NotificationSendInput['channel']
  templateSlug: string
  status: string
  attempts?: number
  recipientId?: string | null
  destination?: string | null
  classification?: NotificationSendInput['classification'] | null
  idempotencyKey: string
  context?: NotificationTemplateContext | null
  templateOverrides?: Partial<NotificationTemplateDefinition> | null
}

const updateDelivery = (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  id: string,
  data: Record<string, unknown>,
) =>
  payload.update({
    collection: options.collections.deliveries as never,
    id,
    data: data as never,
    overrideAccess: true,
  })

/** Maps a dispatch result onto the delivery record. */
const deliveryUpdateFor = (
  result: NotificationDispatchResult,
  retriable: boolean,
): Record<string, unknown> => {
  switch (result.status) {
    case 'sent':
    case 'stored':
    case 'queued':
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        lastError: null,
      }
    case 'skipped':
      return { status: 'skipped', skipReason: result.reason ?? null }
    case 'failed':
      // Retriable failures stay `sending`; the job retry picks the delivery up again.
      return { status: retriable ? 'sending' : 'failed', lastError: result.reason ?? null }
  }
}

/**
 * Processes one `notification-deliveries` record: re-checks the recipient and
 * policy at send time, renders the template against the context captured when
 * the delivery was planned, dispatches it and records the outcome.
 *
 * Already-final deliveries are not sent again. Retriable provider failures
 * throw so Payload retries the same job.
 */
export const sendDelivery = async ({
  payload,
  input,
  options,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
}): Promise<NotificationDispatchResult> => {
  const deliveryId = input.deliveryId as string
  const delivery = (await payload.findByID({
    collection: options.collections.deliveries as never,
    id: deliveryId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as DeliveryDoc | null

  if (!delivery) {
    return { channel: input.channel, status: 'skipped', reason: 'Delivery not found' }
  }

  if (FINAL_DELIVERY_STATUSES.has(delivery.status)) {
    return {
      channel: delivery.channel,
      status: 'skipped',
      reason: `Delivery already ${delivery.status}`,
    }
  }

  const attempt = (delivery.attempts ?? 0) + 1
  await updateDelivery(payload, options, deliveryId, { status: 'sending', attempts: attempt })

  const sendInput: NotificationSendInput = {
    userId: delivery.recipientId ?? '',
    channel: delivery.channel,
    template: delivery.templateSlug,
    event: delivery.event,
    eventId: delivery.eventId,
    eventPayload: delivery.context?.payload,
    classification: delivery.classification ?? undefined,
    idempotencyKey: delivery.idempotencyKey,
    templateOverrides: delivery.templateOverrides ?? undefined,
    deliveryId,
    destination: delivery.destination ?? undefined,
    attempt,
    jobId: input.jobId,
  }
  const fingerprint = delivery.idempotencyKey

  const finish = async (
    result: NotificationDispatchResult,
    classification?: 'retriable' | 'terminal',
    extra: Record<string, unknown> = {},
  ): Promise<NotificationDispatchResult> => {
    await updateDelivery(payload, options, deliveryId, {
      ...deliveryUpdateFor(result, classification === 'retriable'),
      ...extra,
    })
    if (options.observability.onDispatch) {
      await options.observability.onDispatch(
        createObservabilityEvent({ input: sendInput, result, fingerprint, classification }),
      )
    }
    return result
  }

  const stop = async (status: 'failed' | 'skipped', reason: string) => {
    await writeNotificationLog({
      payload,
      options,
      input: sendInput,
      status,
      error: reason,
      fingerprint,
      failureClassification: 'terminal',
    })
    return finish({ channel: delivery.channel, status, reason }, 'terminal')
  }

  // Consent and preferences are checked at send time against the current user.
  let user: Record<string, unknown> = {}
  if (delivery.recipientId) {
    const found = await payload.findByID({
      overrideAccess: true,
      collection: options.userCollectionSlug as never,
      id: delivery.recipientId,
      disableErrors: true,
    })
    if (!found) return stop('failed', 'User not found')
    user = found as Record<string, unknown>
  }

  const policy = await evaluateNotificationPolicy({ user, input: sendInput, options })
  if (!policy.allow) {
    return stop('skipped', policy.reason || 'Notification blocked by policy')
  }

  const resolved = await resolveTemplate({
    event: delivery.event,
    channel: delivery.channel,
    templateKey: delivery.templateSlug,
    options,
    payload,
  })
  const definition = mergeTemplateDefinition(resolved.definition, sendInput.templateOverrides)
  const context: NotificationTemplateContext = delivery.context ?? {
    event: delivery.event,
    userId: sendInput.userId,
    payload: {},
  }

  const renderStarted = Date.now()
  const rendered = renderDefinition(definition, context)
  const renderDurationMs = Date.now() - renderStarted

  const dispatched =
    (await dispatchToChannel({
      payload,
      input: sendInput,
      options,
      rendered,
      fingerprint,
      templateSlug: resolved.templateSlug,
      templateVersion: resolved.templateVersion,
      renderDurationMs,
      context,
    })) || ({ channel: delivery.channel, status: 'sent' } satisfies NotificationDispatchResult)

  const classification =
    dispatched.status === 'failed' && dispatched.reason
      ? classifyDispatchFailure(dispatched.reason).classification
      : undefined

  const result = await finish(
    dispatched,
    classification,
    typeof resolved.templateVersion === 'number'
      ? { templateVersion: resolved.templateVersion }
      : {},
  )

  if (result.status === 'failed' && classification === 'retriable') {
    throw new Error(result.reason || 'Retriable notification dispatch failure')
  }

  return result
}

/** Marks a delivery failed after its send job exhausted retries. */
export const markDeliveryFailed = async ({
  payload,
  options,
  deliveryId,
  reason,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  deliveryId: string
  reason: string
}) => {
  await updateDelivery(payload, options, deliveryId, { status: 'failed', lastError: reason })
}
