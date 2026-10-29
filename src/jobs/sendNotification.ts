import type { Payload } from 'payload'
import type {
  AdminTriggerRecord,
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
} from '../types'
import { dispatchToChannel } from '../channels/dispatch'
import { buildDataContext } from '../data/buildContext'
import { sendDelivery } from '../deliveries/send'
import { createSensitiveFieldMatcher } from '../data/sensitive'
import { evaluateNotificationPolicy } from '../policy/evaluatePolicy'
import {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from '../reliability'
import { resolveTemplate } from '../templates/resolve'
import { finalizeForChannel } from '../templates/channelContent'
import { mergeTemplateDefinition, renderDefinition } from '../templates/renderDefinition'
import { NOTIFICATION_SEND_TASK, NOTIFICATIONS_JOB_QUEUE } from './constants'
import { writeNotificationLog } from './writeLog'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const emitObservability = async ({
  options,
  input,
  result,
  fingerprint,
  classification,
}: {
  options: NormalizedNotificationsPluginOptions
  input: NotificationSendInput
  result: NotificationDispatchResult
  fingerprint?: string
  classification?: 'retriable' | 'terminal'
}) => {
  if (!options.observability.onDispatch) return

  await options.observability.onDispatch(
    createObservabilityEvent({
      input,
      result,
      fingerprint,
      classification,
    }),
  )
}

export const assertNotificationSendInput = (value: unknown): NotificationSendInput => {
  if (!isObject(value)) {
    throw new Error('payload-notifications: notification send input must be an object')
  }

  const deliveryId =
    typeof value.deliveryId === 'string' || typeof value.deliveryId === 'number'
      ? String(value.deliveryId)
      : undefined

  // Delivery sends to static recipients have no user; legacy sends always need one.
  if (typeof value.userId !== 'string' || (!deliveryId && !value.userId.trim())) {
    throw new Error('payload-notifications: notification send input requires a userId')
  }

  if (typeof value.channel !== 'string' || !value.channel.trim()) {
    throw new Error('payload-notifications: notification send input requires a channel')
  }

  if (typeof value.template !== 'string' || !value.template.trim()) {
    throw new Error('payload-notifications: notification send input requires a template')
  }

  if (typeof value.event !== 'string' || !value.event.trim()) {
    throw new Error('payload-notifications: notification send input requires an event')
  }

  if (value.eventPayload !== undefined && !isObject(value.eventPayload)) {
    throw new Error('payload-notifications: notification send eventPayload must be an object')
  }

  if (value.dataSources !== undefined && !Array.isArray(value.dataSources)) {
    throw new Error('payload-notifications: notification send dataSources must be an array')
  }

  const templateOverrides =
    value.templateOverrides !== undefined && isObject(value.templateOverrides)
      ? (value.templateOverrides as NotificationSendInput['templateOverrides'])
      : undefined

  return {
    userId: value.userId,
    channel: value.channel as NotificationSendInput['channel'],
    template: value.template,
    event: value.event,
    eventPayload: value.eventPayload,
    classification:
      value.classification === 'marketing' || value.classification === 'transactional'
        ? value.classification
        : undefined,
    idempotencyKey: typeof value.idempotencyKey === 'string' ? value.idempotencyKey : undefined,
    attempt: typeof value.attempt === 'number' ? value.attempt : 1,
    templateOverrides,
    jobId:
      typeof value.jobId === 'string' || typeof value.jobId === 'number' ? value.jobId : undefined,
    eventId: typeof value.eventId === 'string' ? value.eventId : undefined,
    occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : undefined,
    dataSources: value.dataSources as NotificationSendInput['dataSources'],
    deliveryId,
    destination: typeof value.destination === 'string' ? value.destination : undefined,
  }
}

export const queueNotificationSend = async ({
  payload,
  input,
  queue = NOTIFICATIONS_JOB_QUEUE,
}: {
  payload: Payload
  input: NotificationSendInput
  queue?: string
}) => {
  const validatedInput = assertNotificationSendInput(input)

  await payload.jobs.queue({
    overrideAccess: true,
    task: NOTIFICATION_SEND_TASK,
    queue,
    input: validatedInput,
  })
}

export const sendNotification = async ({
  payload,
  input,
  options,
  adminTriggers,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  /** Published admin triggers, used when a scheduled delivery re-checks its conditions. */
  adminTriggers?: AdminTriggerRecord[]
}): Promise<NotificationDispatchResult | void> => {
  const validatedInput = assertNotificationSendInput(input)
  if (validatedInput.deliveryId) {
    return sendDelivery({ payload, input: validatedInput, options, adminTriggers })
  }
  const fingerprint = buildDeliveryFingerprint(validatedInput)

  const existingLogs =
    typeof payload.find === 'function'
      ? await payload.find({
          overrideAccess: true,
          collection: options.collections.logs,
          where: {
            and: [
              { fingerprint: { equals: fingerprint } },
              { status: { in: ['sent', 'stored', 'skipped'] } },
            ],
          },
          limit: 1,
        })
      : { docs: [] }

  if (existingLogs.docs?.length) {
    const result = {
      channel: validatedInput.channel,
      status: 'skipped' as const,
      reason: 'Duplicate notification blocked by idempotency fingerprint',
    }

    await emitObservability({
      options,
      input: validatedInput,
      result,
      fingerprint,
    })

    return result
  }

  const user = await payload.findByID({
    overrideAccess: true,
    collection: options.userCollectionSlug,
    id: validatedInput.userId,
  })

  if (!user) {
    const result = {
      channel: validatedInput.channel,
      status: 'failed' as const,
      reason: 'User not found',
    }

    await writeNotificationLog({
      payload,
      options,
      input: validatedInput,
      status: 'failed',
      error: result.reason,
      fingerprint,
      failureClassification: 'terminal',
    })

    await emitObservability({
      options,
      input: validatedInput,
      result,
      fingerprint,
      classification: 'terminal',
    })

    return result
  }

  const policyDecision = await evaluateNotificationPolicy({
    user: user as Record<string, unknown>,
    input: validatedInput,
    options,
  })

  if (!policyDecision.allow) {
    const result = {
      channel: validatedInput.channel,
      status: 'skipped' as const,
      reason: policyDecision.reason || 'Notification blocked by policy',
    }

    await writeNotificationLog({
      payload,
      options,
      input: validatedInput,
      status: 'skipped',
      error: result.reason,
      fingerprint,
      failureClassification: 'terminal',
    })

    await emitObservability({
      options,
      input: validatedInput,
      result,
      fingerprint,
    })

    return result
  }

  const dataContext = await buildDataContext({
    payload,
    event: {
      name: validatedInput.event,
      eventId: validatedInput.eventId,
      occurredAt: validatedInput.occurredAt,
      userId: validatedInput.userId,
      classification: validatedInput.classification,
      payload: validatedInput.eventPayload,
    },
    userId: validatedInput.userId,
    sources: validatedInput.dataSources,
    dataResolvers: options.dataResolvers,
    computed: options.computed,
    isSensitive: createSensitiveFieldMatcher(options.data.sensitiveFields),
    owner: `${validatedInput.event} → ${validatedInput.channel}`,
  })

  if (!dataContext.ok) {
    const result = {
      channel: validatedInput.channel,
      status: 'skipped' as const,
      reason: `${dataContext.reason} (${dataContext.source}): ${dataContext.message}`,
    }

    await writeNotificationLog({
      payload,
      options,
      input: validatedInput,
      status: 'skipped',
      error: result.reason,
      fingerprint,
      failureClassification: 'terminal',
    })

    await emitObservability({
      options,
      input: validatedInput,
      result,
      fingerprint,
    })

    return result
  }

  const resolved = await resolveTemplate({
    event: validatedInput.event,
    channel: validatedInput.channel,
    templateKey: validatedInput.template,
    options,
    payload,
  })

  const definition = mergeTemplateDefinition(resolved.definition, validatedInput.templateOverrides)
  const context: NotificationTemplateContext = dataContext.context

  const renderStarted = Date.now()
  const rendered = await finalizeForChannel(
    renderDefinition(definition, context),
    validatedInput.channel,
    options,
  )
  const renderDurationMs = Date.now() - renderStarted

  const result = await dispatchToChannel({
    payload,
    input: validatedInput,
    options,
    rendered,
    fingerprint,
    templateSlug: resolved.templateSlug,
    templateVersion: resolved.templateVersion,
    renderDurationMs,
    context,
  })

  const finalResult =
    result ||
    ({
      channel: validatedInput.channel,
      status: 'sent',
    } satisfies NotificationDispatchResult)

  const failureClassification =
    finalResult.status === 'failed' && finalResult.reason
      ? classifyDispatchFailure(finalResult.reason).classification
      : undefined

  await emitObservability({
    options,
    input: validatedInput,
    result: finalResult,
    fingerprint,
    classification: failureClassification,
  })

  // Retriable provider failures must throw so Payload retries the same job.
  if (finalResult.status === 'failed' && failureClassification === 'retriable') {
    throw new Error(finalResult.reason || 'Retriable notification dispatch failure')
  }

  return finalResult
}
