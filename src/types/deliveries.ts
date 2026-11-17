import type { Payload } from 'payload'
import type { NotificationChannel } from './channels'
import type { NotificationDataSource } from './data-sources'
import type { NotificationClassification, NotificationEventPayload } from './events'
import type { NotificationTemplateContext, NotificationTemplateDefinition } from './templates'

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
  eventId?: string
  trigger?: string
  triggerSource?: 'code' | 'admin'
  deliveryId?: string
  stage?: NotificationLifecycleStage
  /** Provider call duration. */
  durationMs?: number
}

export type NotificationObservabilityHook = (event: ObservabilityEvent) => void | Promise<void>

export type NotificationLifecycleStage =
  | 'matched'
  | 'planned'
  | 'skipped'
  | 'sent'
  | 'retrying'
  | 'failed'
  | 'unknown'
  | 'cancelled'
  | 'delivered'
  /**
   * A matched trigger's conditions did not hold at planning time; nothing was planned.
   * Emitted only with `observability.planningStages`.
   */
  | 'conditions-not-met'
  /**
   * Planning found a delivery that already holds this delivery's key, so none was created.
   * `deliveryId` is the existing delivery. Emitted only with `observability.planningStages`.
   */
  | 'duplicate'

/** One step of a notification's life, for `observability.onEvent`. */
export type NotificationLifecycleEvent = {
  type: 'notification.lifecycle'
  stage: NotificationLifecycleStage
  /** Event name. */
  event?: string
  eventId?: string
  trigger?: string
  triggerSource?: 'code' | 'admin'
  triggerVersion?: number
  deliveryId?: string
  channel?: NotificationChannel
  /** `user:<id>`, or a masked email / phone for static recipients. */
  recipient?: string
  reason?: string
  provider?: string
  providerMessageId?: string
  attempt?: number
  durationMs?: number
  at: string
}

/** Second argument of `observability.onEvent`. */
export type NotificationLifecycleContext = {
  payload: Payload
  /**
   * The delivery's idempotency key (`notification-deliveries.idempotencyKey`), when the
   * event concerns one delivery. It can contain an address with the default delivery key,
   * so treat it as personal data.
   */
  idempotencyKey?: string
}

export type NotificationLifecycleHook = (
  event: NotificationLifecycleEvent,
  /** Always passed since 0.4.0-beta.5; optional so older handler types still fit. */
  context?: NotificationLifecycleContext,
) => void | Promise<void>

/**
 * What one delivery is unique on (`deliveries.key`):
 * - `trigger`: event, trigger, recipient, channel and template (default).
 * - `recipient`: event, recipient and channel. Two triggers or templates for the same
 *   event never reach one recipient twice on a channel.
 */
export type NotificationDeliveryKeyMode = 'trigger' | 'recipient'

/** The delivery about to be sent, for `deliveries.beforeSend`. */
export type NotificationBeforeSendDelivery = {
  id: string
  event: string
  eventId?: string
  trigger: string
  channel: NotificationChannel
  template: string
  /** `user:<id>`, `email:<address>` or `phone:<e164>`. */
  recipientKey?: string
  recipientId?: string
  /** Raw email address or phone number. Personal data: do not log it. */
  destination?: string
  idempotencyKey: string
  classification?: NotificationClassification
  category?: string
  /** Template context captured at planning time (`payload`, `recipient`, data sources). */
  context?: NotificationTemplateContext
  scheduledFor?: string
}

export type NotificationBeforeSendArgs = {
  payload: Payload
  delivery: NotificationBeforeSendDelivery
  /** 1 on the first attempt, 2 on the first retry, and so on. */
  attempt: number
}

/** Return `{ allow: false, reason }` to cancel the delivery; anything else sends it. */
export type NotificationBeforeSendDecision = { allow: boolean; reason?: string }

export type NotificationBeforeSendHook = (
  args: NotificationBeforeSendArgs,
) =>
  | void
  | NotificationBeforeSendDecision
  | undefined
  | Promise<void | NotificationBeforeSendDecision | undefined>

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
  /** Identifier of the event occurrence that produced this send. */
  eventId?: string
  occurredAt?: string
  /** Data sources resolved into the template context before rendering. */
  dataSources?: NotificationDataSource[]
  /** `notification-deliveries` record this send processes (delivery-based pipeline). */
  deliveryId?: string
  /** Resolved channel destination (email address / E.164 phone); skips the user lookup. */
  destination?: string
}

export type NotificationDispatchStatus =
  | 'queued'
  | 'sent'
  | 'stored'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'unknown'

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
