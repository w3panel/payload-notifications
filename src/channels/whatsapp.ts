import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
} from '../types'
import { createWhatsAppProvider } from '../providers/whatsapp'

export const sendWhatsAppNotification = async ({
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
        channel: 'whatsapp',
        status: 'skipped',
        template: input.template,
        error: 'User phone not found for WhatsApp delivery',
      },
    })

    return {
      channel: 'whatsapp',
      status: 'skipped',
      reason: 'User phone not found for WhatsApp delivery',
    }
  }

  const provider = createWhatsAppProvider(options)
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
        channel: 'whatsapp',
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
      channel: 'whatsapp',
      status: 'sent',
      provider: result.provider,
      providerMessageId: result.messageId,
      response: result.response,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WhatsApp send failed'

    await payload.create({
      overrideAccess: true,
      collection: options.collections.logs,
      data: {
        user: input.userId,
        event: input.event,
        channel: 'whatsapp',
        status: 'failed',
        template: input.template,
        error: message,
      },
    })

    return {
      channel: 'whatsapp',
      status: 'failed',
      reason: message,
      provider: options.providers.whatsapp?.provider,
    }
  }
}
