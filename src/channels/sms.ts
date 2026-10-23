import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
} from '../types'
import { createSMSProvider } from '../providers/sms'

export const sendSMSNotification = async ({
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
  const phone = user?.phone || user?.phoneNumber

  if (!phone) {
    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'sms',
        status: 'skipped',
        template: input.template,
        error: 'User phone not found for SMS delivery',
      },
    })

    return {
      channel: 'sms',
      status: 'skipped',
      reason: 'User phone not found for SMS delivery',
    }
  }

  const provider = createSMSProvider(options)
  const context: NotificationTemplateContext = {
    event: input.event,
    userId: input.userId,
    payload: input.eventPayload,
  }

  try {
    const result = await provider.send({
      to: phone,
      template: input.template,
      context,
    })

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'sms',
        status: 'sent',
        template: input.template,
        providerResponse: {
          provider: result.provider,
          messageId: result.messageId,
          raw: result.response,
        },
      },
    })

    return {
      channel: 'sms',
      status: 'sent',
      provider: result.provider,
      providerMessageId: result.messageId,
      response: result.response,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMS send failed'

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'sms',
        status: 'failed',
        template: input.template,
        error: message,
      },
    })

    return {
      channel: 'sms',
      status: 'failed',
      reason: message,
      provider: options.providers.sms?.provider,
    }
  }
}
