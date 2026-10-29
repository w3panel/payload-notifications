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
    // Without a caller key, the event occurrence keeps distinct events apart.
    input.idempotencyKey || (input.eventId ? `event:${input.eventId}` : 'no-idempotency-key'),
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
  extra,
}: {
  input: NotificationSendInput
  result: NotificationDispatchResult
  fingerprint?: string
  classification?: 'retriable' | 'terminal'
  /** Delivery-pipeline fields (trigger, deliveryId, stage, durationMs). */
  extra?: Pick<ObservabilityEvent, 'trigger' | 'triggerSource' | 'stage' | 'durationMs'>
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
  ...(input.eventId ? { eventId: input.eventId } : {}),
  ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
  ...extra,
})
