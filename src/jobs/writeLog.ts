import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchStatus,
  NotificationSendInput,
} from '../types'
import { toRelationId } from '../relationId'

export type WriteNotificationLogInput = {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  input: Pick<
    NotificationSendInput,
    'userId' | 'event' | 'channel' | 'template' | 'idempotencyKey' | 'attempt' | 'jobId'
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
}: WriteNotificationLogInput) => {
  const providerResponse =
    provider || providerMessageId || providerResponseRaw !== undefined
      ? {
          ...(provider ? { provider } : {}),
          ...(providerMessageId ? { messageID: providerMessageId } : {}),
          ...(providerResponseRaw !== undefined ? { raw: providerResponseRaw } : {}),
        }
      : undefined

  const jobMeta =
    input.jobId !== undefined
      ? {
          jobId: input.jobId,
          ...meta,
        }
      : meta

  await payload.create({
    overrideAccess: true,
    collection: options.collections.logs,
    data: {
      ...(input.userId
        ? { user: toRelationId(payload, options.userCollectionSlug, input.userId) }
        : {}),
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
      ...(jobMeta ? { meta: jobMeta } : {}),
    },
  })
}
