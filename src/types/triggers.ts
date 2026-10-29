import type { NotificationChannel } from './channels'
import type { NotificationEventPayload } from './events'
import type { NotificationTemplateDefinition } from './templates'

export type NotificationRule = {
  event: string
  channels: NotificationChannel[]
  template: string
  enabled?: boolean
  condition?: (payload: NotificationEventPayload) => boolean | Promise<boolean>
  templateOverrides?: Partial<Record<NotificationChannel, Partial<NotificationTemplateDefinition>>>
}

export type NotificationTriggerDefinition = NotificationRule
