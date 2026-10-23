import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
} from '../types'
import { renderTemplate } from '../templates/render'

export const sendEmailNotification = async ({
  payload,
  input,
  options,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
}): Promise<NotificationDispatchResult> => {
  const user = await payload.findByID({
    overrideAccess: true,
    collection: options.userCollectionSlug,
    id: input.userId,
  })

  if (!user?.email) {
    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'email',
        status: 'skipped',
        template: input.template,
        error: 'User email not found',
      },
    })

    return {
      channel: 'email',
      status: 'skipped',
      reason: 'User email not found',
    }
  }

  const context: NotificationTemplateContext = {
    event: input.event,
    userId: input.userId,
    payload: input.eventPayload,
  }

  let rendered

  try {
    rendered = await renderTemplate(input.template, context)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Template rendering failed'

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'email',
        status: 'failed',
        template: input.template,
        error: message,
      },
    })

    return {
      channel: 'email',
      status: 'failed',
      reason: message,
      provider: 'payload-email',
    }
  }

  try {
    await payload.sendEmail({
      to: user.email,
      subject: rendered.subject || `Notification: ${input.event}`,
      html: rendered.html || `<p>${rendered.text || input.template}</p>`,
      text: rendered.text,
      from: options.providers.email?.defaultFromAddress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed'

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'email',
        status: 'failed',
        template: input.template,
        error: message,
      },
    })

    return {
      channel: 'email',
      status: 'failed',
      reason: message,
      provider: 'payload-email',
    }
  }

  await payload.create({
    overrideAccess: true,
    collection: options.collections.logs,
    data: {
      user: input.userId,
      event: input.event,
      channel: 'email',
      status: 'sent',
      template: input.template,
      providerResponse: {
        provider: 'payload-email',
        raw: rendered.meta,
      },
    },
  })

  return {
    channel: 'email',
    status: 'sent',
    provider: 'payload-email',
    response: rendered.meta,
  }
}
