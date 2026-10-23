import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
} from '../types'
import { sendEmailNotification } from '../channels/email'
import { sendInAppNotification } from '../channels/inapp'
import { sendSMSNotification } from '../channels/sms'
import { sendWhatsAppNotification } from '../channels/whatsapp'
import { evaluateNotificationPolicy } from '../policy/evaluatePolicy'
import {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from '../reliability'
import { resolveTemplate } from '../templates/resolve'

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

const createLog = async ({
  payload,
  options,
  input,
  status,
  reason,
  fingerprint,
  classification,
  provider,
  providerMessageId,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  input: NotificationSendInput
  status: 'sent' | 'stored' | 'failed' | 'skipped'
  reason?: string
  fingerprint: string
  classification?: 'retriable' | 'terminal'
  provider?: string
  providerMessageId?: string
}) => {
  await payload.create({
    overrideAccess: true,
    collection: options.collections.logs,
    data: {
      user: input.userId,
      event: input.event,
      channel: input.channel,
      status,
      template: input.template,
      reason,
      fingerprint,
      idempotencyKey: input.idempotencyKey,
      attempt: input.attempt ?? 1,
      classification,
      provider,
      providerMessageId,
    },
  })
}

export const assertNotificationSendInput = (value: unknown): NotificationSendInput => {
  if (!isObject(value)) {
    throw new Error('payload-notifications: notification send input must be an object')
  }

  if (typeof value.userId !== 'string' || !value.userId.trim()) {
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
  }
}

export const queueNotificationSend = async ({
  payload,
  input,
}: {
  payload: Payload
  input: NotificationSendInput
}) => {
  const validatedInput = assertNotificationSendInput(input)

  await payload.jobs.queue({
    overrideAccess: true,
    task: 'notification:send',
    input: validatedInput,
  })
}

export const sendNotification = async ({
  payload,
  input,
  options,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
}): Promise<NotificationDispatchResult | void> => {
  const validatedInput = assertNotificationSendInput(input)
  const fingerprint = buildDeliveryFingerprint(validatedInput)

  const existingLogs =
    typeof (payload as any).find === 'function'
      ? await (payload as any).find({
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

    await createLog({
      payload,
      options,
      input: validatedInput,
      status: 'failed',
      reason: result.reason,
      fingerprint,
      classification: 'terminal',
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

    await createLog({
      payload,
      options,
      input: validatedInput,
      status: 'skipped',
      reason: result.reason,
      fingerprint,
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

  let result: NotificationDispatchResult | void

  switch (validatedInput.channel) {
    case 'email': {
      const sendInput = { ...validatedInput, template: resolved.definition.body }
      result = await sendEmailNotification({ payload, input: sendInput, options })
      break
    }
    case 'whatsapp': {
      const sendInput = { ...validatedInput, template: resolved.definition.body }
      result = await sendWhatsAppNotification({ payload, input: sendInput, options })
      break
    }
    case 'sms': {
      const sendInput = { ...validatedInput, template: resolved.definition.body }
      result = await sendSMSNotification({ payload, input: sendInput, options })
      break
    }
    case 'inapp':
      result = await sendInAppNotification({
        payload,
        input: validatedInput,
        options,
        resolvedDefinition: resolved.definition,
      })
      break
    default:
      throw new Error(`Unsupported notification channel: ${validatedInput.channel}`)
  }

  const finalResult =
    result ||
    ({
      channel: validatedInput.channel,
      status: 'sent',
    } satisfies NotificationDispatchResult)

  const channelAlreadyLogged = finalResult.status === 'sent' || finalResult.status === 'stored'

  if (!channelAlreadyLogged) {
    await createLog({
      payload,
      options,
      input: validatedInput,
      status:
        finalResult.status === 'stored'
          ? 'stored'
          : finalResult.status === 'skipped'
            ? 'skipped'
            : 'failed',
      reason: finalResult.reason,
      fingerprint,
      provider: finalResult.provider,
      providerMessageId: finalResult.providerMessageId,
      classification:
        finalResult.status === 'failed' && finalResult.reason
          ? classifyDispatchFailure(finalResult.reason).classification
          : undefined,
    })
  }

  await emitObservability({
    options,
    input: validatedInput,
    result: finalResult,
    fingerprint,
    classification:
      finalResult.status === 'failed' && finalResult.reason
        ? classifyDispatchFailure(finalResult.reason).classification
        : undefined,
  })

  if (
    finalResult.status === 'failed' &&
    finalResult.reason &&
    classifyDispatchFailure(finalResult.reason).classification === 'retriable' &&
    (validatedInput.attempt ?? 1) < 3
  ) {
    await payload.jobs.queue({
      overrideAccess: true,
      task: 'notification:send',
      input: {
        ...validatedInput,
        attempt: (validatedInput.attempt ?? 1) + 1,
      },
    })
  }

  return finalResult
}
