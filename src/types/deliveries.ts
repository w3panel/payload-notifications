import type { NotificationChannel } from './channels'
import type { NotificationClassification, NotificationEventPayload } from './events'
import type { NotificationTemplateDefinition } from './templates'

export type DispatchFailureClassification = 'retriable' | 'terminal'

export type DispatchFailureInfo = {
  classification: DispatchFailureClassification
  message: string
}

export type ObservabilityEvent = {
  type: 'notification.dispatch'
  channel: NotificationChannel
  event: string
  userId: string
  status: NotificationDispatchStatus
  reason?: string
  provider?: string
  providerMessageId?: string
  idempotencyKey?: string
  fingerprint?: string
  attempt?: number
  classification?: DispatchFailureClassification
}

export type NotificationObservabilityHook = (event: ObservabilityEvent) => void | Promise<void>

export type NotificationSendInput = {
  userId: string
  channel: NotificationChannel
  template: string
  event: string
  eventPayload?: NotificationEventPayload
  classification?: NotificationClassification
  idempotencyKey?: string
  /** @deprecated Payload job retries replace custom attempt tracking */
  attempt?: number
  templateOverrides?: Partial<NotificationTemplateDefinition>
  /** Optional Payload job id for log correlation */
  jobId?: string | number
}

export type NotificationDispatchStatus = 'queued' | 'sent' | 'stored' | 'failed' | 'skipped'

export type NotificationDispatchResult = {
  channel: NotificationChannel
  status: NotificationDispatchStatus
  reason?: string
  provider?: string
  providerMessageId?: string
  response?: Record<string, unknown>
}

export type NotificationQueueTask = {
  slug: 'notification:process-event' | 'notification:send'
}

export type NotificationSendJobInput = NotificationSendInput
