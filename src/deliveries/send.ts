import type { Payload } from 'payload'
import type {
  AdminTriggerRecord,
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationLifecycleStage,
  NotificationSendInput,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
} from '../types'
import { NOTIFICATION_SEND_TASK } from '../jobs/constants'
import { writeNotificationLog } from '../jobs/writeLog'
import { deliveryCategory, evaluateDeliveryPolicy, isMandatory } from '../policy/deliveryPolicy'
import { buildUnsubscribeUrl } from '../endpoints/unsubscribe'
import type { DeliveryOutcome } from '../providers/errors'
import { resolveProvider } from '../providers/builtin'
import { emitLifecycle } from '../observability'
import { createObservabilityEvent } from '../reliability'
import { callProvider } from './providerCall'
import { createFallbackDelivery, type FallbackSource } from './fallback'
import { claimDeliveryStatus } from './claim'
import { recheckDelivery } from './recheck'
import { retryDelayMs, type ResolvedRetryPolicy } from './retry'
import { finalizeForChannel } from '../templates/channelContent'
import { mergeTemplateDefinition, renderDefinition } from '../templates/renderDefinition'
import { resolveTemplate } from '../templates/resolve'

/** Statuses after which a delivery is never sent again by the send job. */
export const FINAL_DELIVERY_STATUSES = new Set([
  'sent',
  'delivered',
  'failed',
  'skipped',
  'cancelled',
  'unknown',
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
  trigger: string
  recipientAlias?: string | null
  recheckConditions?: boolean | null
  scheduledFor?: string | null
  category?: string | null
  templateVersion?: number | null
  templateLocale?: string | null
  maxAttempts?: number | null
  retryPolicy?: Pick<ResolvedRetryPolicy, 'backoff' | 'jitter'> | null
} & FallbackSource

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

/** Lifecycle stage for a send result. */
const stageFor = (status: NotificationDispatchResult['status']): NotificationLifecycleStage => {
  switch (status) {
    case 'sent':
    case 'stored':
      return 'sent'
    case 'queued':
      return 'retrying'
    case 'failed':
    case 'unknown':
    case 'cancelled':
    case 'skipped':
      return status
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
  adminTriggers,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  /** Published admin triggers, for `recheckConditions`. */
  adminTriggers?: AdminTriggerRecord[]
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

  const fingerprint = delivery.idempotencyKey
  const attempt = (delivery.attempts ?? 0) + 1
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

  const report = async (
    result: NotificationDispatchResult,
    classification?: 'retriable' | 'terminal',
    durationMs?: number,
  ) => {
    const stage = stageFor(result.status)
    const triggerSource =
      delivery.triggerOrigin === 'admin' || delivery.triggerOrigin === 'code'
        ? delivery.triggerOrigin
        : undefined
    if (options.observability.onDispatch) {
      await options.observability.onDispatch(
        createObservabilityEvent({
          input: sendInput,
          result,
          fingerprint,
          classification,
          extra: { trigger: delivery.trigger, triggerSource, stage, durationMs },
        }),
      )
    }
    await emitLifecycle(payload, options, {
      stage,
      event: delivery.event,
      eventId: delivery.eventId ?? undefined,
      trigger: delivery.trigger,
      triggerSource,
      deliveryId,
      channel: delivery.channel,
      recipient: delivery.recipientKey,
      reason: result.reason,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      attempt,
      durationMs,
      idempotencyKey: delivery.idempotencyKey,
    })
    return result
  }

  /** Compare-and-set from the status this job read; false when another job moved it on. */
  const readStatus = delivery.status
  const claim = (to: string) =>
    claimDeliveryStatus({ payload, options, deliveryId, from: readStatus, to })

  /** Another send job got there first: stop quietly, it reports the outcome. */
  const movedOn = (): NotificationDispatchResult => ({
    channel: delivery.channel,
    status: 'skipped',
    reason: 'Delivery was handled by another send job',
  })

  /** Ends the delivery without a provider call (policy, missing user, recheck). */
  const stop = async (
    status: 'failed' | 'skipped' | 'cancelled' | 'unknown',
    reason: string,
    outcome: DeliveryOutcome,
  ) => {
    // Only the job that moves the delivery out of the status it read may end it.
    if (!(await claim(status))) return movedOn()
    await writeNotificationLog({
      payload,
      options,
      input: sendInput,
      status: status === 'failed' ? 'failed' : 'skipped',
      error: status === 'cancelled' ? `Cancelled: ${reason}` : reason,
      fingerprint,
      failureClassification: 'terminal',
      outcome,
    })
    await updateDelivery(
      payload,
      options,
      deliveryId,
      status === 'failed' || status === 'unknown' ? { lastError: reason } : { skipReason: reason },
    )
    if (outcome === 'policy' || outcome === 'permanent') {
      await createFallbackDelivery({
        payload,
        options,
        primary: delivery,
        reason: outcome,
        detail: reason,
      })
    }
    return report({ channel: delivery.channel, status, reason }, 'terminal')
  }

  // A previous attempt was interrupted after the provider call started: the
  // outcome is ambiguous, so never send again automatically.
  if (delivery.status === 'sending') {
    return stop('unknown', 'A previous send attempt was interrupted; outcome unknown', 'unknown')
  }

  // The application's veto. Nothing has been sent yet, so an error here is safe to retry.
  const beforeSend = options.deliveries.beforeSend
  if (beforeSend) {
    let decision: Awaited<ReturnType<typeof beforeSend>>
    try {
      decision = await beforeSend({
        payload,
        attempt,
        delivery: {
          id: deliveryId,
          event: delivery.event,
          eventId: delivery.eventId ?? undefined,
          trigger: delivery.trigger,
          channel: delivery.channel,
          template: delivery.templateSlug,
          recipientKey: delivery.recipientKey ?? undefined,
          recipientId: delivery.recipientId ?? undefined,
          destination: delivery.destination ?? undefined,
          idempotencyKey: delivery.idempotencyKey,
          classification: delivery.classification ?? undefined,
          category: delivery.category ?? undefined,
          context: delivery.context ?? undefined,
          scheduledFor: delivery.scheduledFor ?? undefined,
        },
      })
    } catch (error) {
      // Count the attempt so the next one reports `attempt + 1`, then let the job retry.
      // If the job's retries run out, `markDeliveryFailed` ends it `failed`.
      await updateDelivery(payload, options, deliveryId, {
        attempts: attempt,
        lastError: `deliveries.beforeSend failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
      throw error
    }
    if (decision && decision.allow === false) {
      return stop(
        'cancelled',
        decision.reason?.trim() || 'Cancelled by deliveries.beforeSend',
        'cancelled',
      )
    }
  }

  // Consent and preferences are checked at send time against the current user.
  let user: Record<string, unknown> = {}
  if (delivery.recipientId) {
    const found = await payload.findByID({
      overrideAccess: true,
      collection: options.userCollectionSlug as never,
      id: delivery.recipientId,
      // Policy reads the user's own fields only; populating relations costs queries.
      depth: 0,
      disableErrors: true,
    })
    if (!found) return stop('failed', 'User not found', 'permanent')
    user = found as Record<string, unknown>
  }

  const category = deliveryCategory(delivery.category, delivery.classification)
  const policy = await evaluateDeliveryPolicy({
    payload,
    options,
    user,
    input: sendInput,
    destination: delivery.destination ?? undefined,
    category,
  })
  if (!policy.allow) {
    return stop('skipped', policy.reason || 'Notification blocked by policy', 'policy')
  }

  const recipientLocale = (delivery.context as { recipient?: { locale?: string } } | null)
    ?.recipient?.locale
  const resolved = await resolveTemplate({
    event: delivery.event,
    channel: delivery.channel,
    templateKey: delivery.templateSlug,
    options,
    payload,
    locale: delivery.templateLocale ?? recipientLocale,
    version: delivery.templateVersion ?? undefined,
  })
  const definition = mergeTemplateDefinition(resolved.definition, sendInput.templateOverrides)
  let context: NotificationTemplateContext = delivery.context ?? {
    event: delivery.event,
    userId: sendInput.userId,
    payload: {},
  }

  // Scheduled deliveries can re-check that they still apply, rendering from fresh data.
  if (delivery.recheckConditions) {
    const recheck = await recheckDelivery({ payload, delivery, options, adminTriggers })
    if (!recheck.ok) return stop('cancelled', recheck.reason, 'cancelled')
    context = recheck.context
  }

  // Opt-out-able deliveries carry a signed one-click unsubscribe link.
  const unsubscribeUrl =
    delivery.recipientId && !isMandatory(options, category, sendInput.classification)
      ? await buildUnsubscribeUrl(payload, options, {
          u: delivery.recipientId,
          c: category,
        })
      : undefined
  if (unsubscribeUrl) context = { ...context, unsubscribeUrl }

  const renderStarted = Date.now()
  const rendered = await finalizeForChannel(
    renderDefinition(definition, context),
    delivery.channel,
    options,
  )
  const renderDurationMs = Date.now() - renderStarted

  const provider = resolveProvider(delivery.channel, options)
  if (!provider || !delivery.destination) {
    return stop(
      'failed',
      provider ? 'Delivery has no destination' : `No provider configured for ${delivery.channel}`,
      'permanent',
    )
  }

  // An approved template is required outside WhatsApp's 24-hour window; don't spend a send on one
  // the provider has rejected or not yet approved.
  const hsm = rendered.whatsappTemplate
  if (hsm?.status && hsm.status.toUpperCase() !== 'APPROVED') {
    return stop('failed', `WhatsApp template "${hsm.name}" is ${hsm.status}`, 'permanent')
  }
  const content =
    hsm && !provider.capabilities.hsm ? { ...rendered, whatsappTemplate: undefined } : rendered

  // Only now is the delivery "sending": anything thrown before this point is safe to retry.
  if (!(await claim('sending'))) return movedOn()
  await updateDelivery(payload, options, deliveryId, { attempts: attempt })
  const call = await callProvider(
    provider,
    {
      to: delivery.destination,
      channel: delivery.channel,
      content: provider.capabilities.html ? content : { ...content, html: '' },
      idempotencyKey: delivery.idempotencyKey,
      ...(unsubscribeUrl && delivery.channel === 'email'
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
      payload,
      options,
      meta: {
        deliveryId,
        event: delivery.event,
        classification: delivery.classification,
        eventPayload: delivery.context?.payload,
      },
    },
    options.providers.timeoutMs,
  )

  const versionPatch =
    typeof resolved.templateVersion === 'number'
      ? { templateVersion: resolved.templateVersion }
      : {}
  const logBase = {
    payload,
    options,
    input: sendInput,
    fingerprint,
    provider: provider.name,
    templateSlug: resolved.templateSlug,
    templateVersion: resolved.templateVersion,
    renderDurationMs,
    durationMs: call.durationMs,
    rendered: { subject: rendered.subject, title: rendered.title, text: rendered.text },
    ...(rendered.segments ? { meta: { segments: rendered.segments } } : {}),
  }

  if (call.ok) {
    const status = call.result.status === 'stored' ? 'stored' : 'sent'
    await writeNotificationLog({
      ...logBase,
      status,
      outcome: status,
      providerMessageId: call.result.providerMessageId,
      providerResponseRaw: call.result.response,
    })
    await updateDelivery(payload, options, deliveryId, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      lastError: null,
      nextAttemptAt: null,
      ...(call.result.providerMessageId
        ? { providerMessageId: call.result.providerMessageId }
        : {}),
      ...versionPatch,
    })
    return report(
      {
        channel: delivery.channel,
        status,
        provider: provider.name,
        providerMessageId: call.result.providerMessageId,
        response: call.result.response,
      },
      undefined,
      call.durationMs,
    )
  }

  await writeNotificationLog({
    ...logBase,
    status: 'failed',
    error: call.message,
    outcome: call.kind,
    failureClassification: call.kind === 'retryable' ? 'retriable' : 'terminal',
  })

  const maxAttempts = delivery.maxAttempts ?? 1
  if (call.kind === 'retryable' && attempt < maxAttempts) {
    const policy = delivery.retryPolicy ?? options.reliability
    const waitUntil = new Date(Date.now() + retryDelayMs(policy, attempt + 1))
    await updateDelivery(payload, options, deliveryId, {
      status: 'queued',
      lastError: call.message,
      nextAttemptAt: waitUntil.toISOString(),
      ...versionPatch,
    })
    await payload.jobs.queue({
      overrideAccess: true,
      task: NOTIFICATION_SEND_TASK,
      queue: options.jobs.queue,
      input: {
        deliveryId,
        userId: delivery.recipientId ?? '',
        channel: delivery.channel,
        template: delivery.templateSlug,
        event: delivery.event,
        eventId: delivery.eventId,
      },
      waitUntil,
    })
    return report(
      {
        channel: delivery.channel,
        status: 'queued',
        reason: `Retry ${attempt + 1}/${maxAttempts} at ${waitUntil.toISOString()}: ${call.message}`,
        provider: provider.name,
      },
      'retriable',
      call.durationMs,
    )
  }

  const status = call.kind === 'unknown' ? 'unknown' : 'failed'
  await updateDelivery(payload, options, deliveryId, {
    status,
    lastError: call.message,
    nextAttemptAt: null,
    ...versionPatch,
  })
  // Permanent failures and exhausted retries may fall back; unknown outcomes never do.
  if (status === 'failed') {
    await createFallbackDelivery({
      payload,
      options,
      primary: delivery,
      reason: 'permanent',
      detail: call.message,
    })
  }
  return report(
    {
      channel: delivery.channel,
      status,
      reason: call.kind === 'unknown' ? `Outcome unknown: ${call.message}` : call.message,
      provider: provider.name,
    },
    'terminal',
    call.durationMs,
  )
}

/**
 * Marks a delivery failed after its send job exhausted retries (for example a
 * `deliveries.beforeSend` hook that kept throwing) and emits a `failed` lifecycle event.
 * A delivery that already reached a final status is left alone. No fallback is created.
 */
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
  const delivery = (await payload.findByID({
    collection: options.collections.deliveries as never,
    id: deliveryId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as DeliveryDoc | null
  if (!delivery || FINAL_DELIVERY_STATUSES.has(delivery.status)) return
  const status = 'failed'
  const won = await claimDeliveryStatus({
    payload,
    options,
    deliveryId,
    from: delivery.status,
    to: status,
  })
  if (!won) return
  await updateDelivery(payload, options, deliveryId, { lastError: reason, nextAttemptAt: null })
  await emitLifecycle(payload, options, {
    stage: status,
    event: delivery.event,
    eventId: delivery.eventId ?? undefined,
    trigger: delivery.trigger,
    triggerSource:
      delivery.triggerOrigin === 'admin' || delivery.triggerOrigin === 'code'
        ? delivery.triggerOrigin
        : undefined,
    deliveryId,
    channel: delivery.channel,
    recipient: delivery.recipientKey,
    reason,
    attempt: delivery.attempts ?? undefined,
    idempotencyKey: delivery.idempotencyKey,
  })
}
