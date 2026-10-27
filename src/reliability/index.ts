import type {
  NotificationDispatchResult,
  NotificationSendInput,
  ObservabilityEvent,
} from '../types'

export type {
  DispatchFailureClassification,
  DispatchFailureInfo,
  ObservabilityEvent,
} from '../types'

export const buildDeliveryFingerprint = (input: NotificationSendInput): string => {
  const parts = [
    input.userId,
    input.channel,
    input.event,
    input.template,
    input.idempotencyKey || 'no-idempotency-key',
  ]

  return parts.join('::')
}

export const classifyDispatchFailure = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown dispatch error'
  const normalized = message.toLowerCase()

  if (
    normalized.includes('timeout') ||
    normalized.includes('temporar') ||
    normalized.includes('rate limit') ||
    normalized.includes('unavailable')
  ) {
    return {
      classification: 'retriable' as const,
      message,
    }
  }

  return {
    classification: 'terminal' as const,
    message,
  }
}

export const createObservabilityEvent = ({
  input,
  result,
  fingerprint,
  classification,
}: {
  input: NotificationSendInput
  result: NotificationDispatchResult
  fingerprint?: string
  classification?: 'retriable' | 'terminal'
}): ObservabilityEvent => ({
  type: 'notification.dispatch',
  channel: input.channel,
  event: input.event,
  userId: input.userId,
  status: result.status,
  reason: result.reason,
  provider: result.provider,
  providerMessageId: result.providerMessageId,
  idempotencyKey: input.idempotencyKey,
  fingerprint,
  attempt: input.attempt,
  classification,
})
