export type NotificationClassification = 'transactional' | 'marketing'

export type NotificationEventPayload = Record<string, unknown>

export type NotificationEvent = {
  name: string
  userId?: string
  payload?: NotificationEventPayload
  classification?: NotificationClassification
  idempotencyKey?: string
}

export type NotificationProcessEventJobInput = NotificationEvent
