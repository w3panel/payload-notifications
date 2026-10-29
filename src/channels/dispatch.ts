import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
  RenderedNotificationContent,
} from '../types'
import { sendEmailNotification } from './email'
import { sendInAppNotification } from './inapp'
import { sendSMSNotification } from './sms'
import { sendWhatsAppNotification } from './whatsapp'

/** Sends rendered content through the input's channel. */
export const dispatchToChannel = async ({
  payload,
  input,
  options,
  rendered,
  fingerprint,
  templateSlug,
  templateVersion,
  renderDurationMs,
  context,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  rendered: RenderedNotificationContent
  fingerprint?: string
  templateSlug?: string
  templateVersion?: number
  renderDurationMs?: number
  context?: NotificationTemplateContext
}): Promise<NotificationDispatchResult | void> => {
  const common = {
    payload,
    input,
    options,
    rendered,
    fingerprint,
    templateSlug,
    templateVersion,
    renderDurationMs,
  }

  switch (input.channel) {
    case 'email':
      return sendEmailNotification(common)
    case 'whatsapp':
      return sendWhatsAppNotification(common)
    case 'sms':
      return sendSMSNotification(common)
    case 'inapp':
      return sendInAppNotification({ ...common, context })
    default:
      throw new Error(`Unsupported notification channel: ${input.channel}`)
  }
}
