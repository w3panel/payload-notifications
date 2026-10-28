import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
  RenderedNotificationContent,
} from '../types'
import { writeNotificationLog } from '../jobs/writeLog'
import { renderDefinition } from '../templates/renderDefinition'

export const sendInAppNotification = async ({
  payload,
  input,
  options,
  rendered,
  resolvedDefinition,
  fingerprint,
  templateSlug,
  templateVersion,
  renderDurationMs,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  rendered?: RenderedNotificationContent
  resolvedDefinition?: NotificationTemplateDefinition
  fingerprint?: string
  templateSlug?: string
  templateVersion?: number
  renderDurationMs?: number
}): Promise<NotificationDispatchResult> => {
  try {
    const context: NotificationTemplateContext = {
      event: input.event,
      userId: input.userId,
      payload: input.eventPayload,
    }

    let title = rendered?.title
    let message = rendered?.body

    if ((!title || !message) && resolvedDefinition) {
      const fallback = renderDefinition(resolvedDefinition, context)
      title = title || fallback.title
      message = message || fallback.body
    }

    if (!message) {
      message = renderDefinition({ body: input.template }, context).body
    }

    if (!title) {
      title = `Notification: ${input.event}`
    }

    await payload.create({
      overrideAccess: true,
      collection: options.collections.notifications,
      data: {
        title,
        message,
        recipient: input.userId,
        meta: {
          data: input.eventPayload,
        },
      },
    })

    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'stored',
      fingerprint,
      templateSlug,
      templateVersion,
      renderDurationMs,
    })

    return {
      channel: 'inapp',
      status: 'stored',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'In-app notification store failed'

    try {
      await writeNotificationLog({
        payload,
        options,
        input,
        status: 'failed',
        error: message,
        fingerprint,
        failureClassification: 'terminal',
      })
    } catch {
      // Best-effort failure logging
    }

    return {
      channel: 'inapp',
      status: 'failed',
      reason: message,
    }
  }
}
