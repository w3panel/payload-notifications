import type { NotificationChannel } from './channels'
import type { NotificationClassification, NotificationEventPayload } from './events'

export type PreferenceFieldMapping = {
  channels?: string
  marketingConsent?: string
}

export type NotificationPolicyDecision = {
  allow: boolean
  reason?: string
}

export type NotificationPolicyContext = {
  channel: NotificationChannel
  event: string
  classification?: NotificationClassification
  user: Record<string, unknown>
  payload?: NotificationEventPayload
}
