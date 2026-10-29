import type { Payload } from 'payload'
import { createSensitiveFieldMatcher, redactContext } from '../data/sensitive'
import type { DeliveryOutcome } from '../providers/errors'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchStatus,
  NotificationSendInput,
} from '../types'

export type WriteNotificationLogInput = {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  input: Pick<
    NotificationSendInput,
    | 'userId'
    | 'event'
    | 'channel'
    | 'template'
    | 'idempotencyKey'
    | 'attempt'
    | 'jobId'
    | 'deliveryId'
  >
  status: NotificationDispatchStatus
  error?: string
  fingerprint?: string
  failureClassification?: 'retriable' | 'terminal'
  provider?: string
  providerMessageId?: string
  providerResponseRaw?: Record<string, unknown> | unknown
  templateSlug?: string
  templateVersion?: number
  renderDurationMs?: number
  meta?: Record<string, unknown>
  /** Provider call duration. */
  durationMs?: number
  /** Outcome in the delivery failure taxonomy. */
  outcome?: DeliveryOutcome
  /** Rendered content; stored only with `logs.storeRendered`. */
  rendered?: { subject?: string; title?: string; text?: string }
}

/**
 * Single write path for notification-logs so channels and jobs stay schema-aligned.
 */
export const writeNotificationLog = async ({
  payload,
  options,
  input,
  status,
  error,
  fingerprint,
  failureClassification,
  provider,
  providerMessageId,
  providerResponseRaw,
  templateSlug,
  templateVersion,
  renderDurationMs,
  meta,
  durationMs,
  outcome,
  rendered,
}: WriteNotificationLogInput) => {
  // Provider responses can echo credentials or message content; mask sensitive keys.
  const safeRaw =
    providerResponseRaw !== undefined
      ? redactContext(
          providerResponseRaw,
          [],
          createSensitiveFieldMatcher(options.data?.sensitiveFields),
        )
      : undefined

  const providerResponse =
    provider || providerMessageId || providerResponseRaw !== undefined
      ? {
          ...(provider ? { provider } : {}),
          ...(providerMessageId ? { messageID: providerMessageId } : {}),
          ...(safeRaw !== undefined ? { raw: safeRaw } : {}),
        }
      : undefined

  const jobMeta =
    input.jobId !== undefined || input.deliveryId !== undefined
      ? {
          ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
          ...(input.deliveryId !== undefined ? { deliveryId: input.deliveryId } : {}),
          ...meta,
        }
      : meta

  await payload.create({
    overrideAccess: true,
    collection: options.collections.logs,
    data: {
      ...(input.userId ? { user: input.userId } : {}),
      event: input.event,
      channel: input.channel,
      status,
      template: input.template,
      ...(error ? { error } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      attempt: input.attempt ?? 1,
      ...(failureClassification ? { failureClassification } : {}),
      ...(templateSlug ? { templateSlug } : {}),
      ...(typeof templateVersion === 'number' ? { templateVersion } : {}),
      ...(typeof renderDurationMs === 'number' ? { renderDurationMs } : {}),
      ...(providerResponse ? { providerResponse } : {}),
      ...(input.deliveryId !== undefined ? { delivery: input.deliveryId } : {}),
      ...(outcome ? { outcome } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(jobMeta || (rendered && options.logs?.storeRendered)
        ? {
            meta: {
              ...jobMeta,
              ...(rendered && options.logs?.storeRendered ? { rendered } : {}),
            },
          }
        : {}),
    },
  })
}
