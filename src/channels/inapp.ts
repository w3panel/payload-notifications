import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
} from '../types'
import { renderTemplate } from '../templates/render'

export const sendInAppNotification = async ({
  payload,
  input,
  options,
  resolvedDefinition,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  resolvedDefinition?: NotificationTemplateDefinition
}): Promise<NotificationDispatchResult> => {
  try {
    const context: NotificationTemplateContext = {
      event: input.event,
      userId: input.userId,
      payload: input.eventPayload,
    }

    let title = `Notification: ${input.event}`
    let message = input.template

    if (resolvedDefinition) {
      if (resolvedDefinition.title) {
        title = (await renderTemplate(resolvedDefinition.title, context)).text || title
      }
      if (resolvedDefinition.body) {
        message = (await renderTemplate(resolvedDefinition.body, context)).text || message
      }
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

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'inapp',
        status: 'stored',
        template: input.template,
      },
    })

    return {
      channel: 'inapp',
      status: 'stored',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'In-app notification store failed'

    try {
      await payload.create({
        overrideAccess: true,
        collection: options.collections.logs,
        data: {
          user: input.userId,
          event: input.event,
          channel: 'inapp',
          status: 'failed',
          template: input.template,
          error: message,
        },
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
