import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  NotificationTemplateContext,
  RenderedNotificationContent,
} from '../types'
import { writeNotificationLog } from '../jobs/writeLog'
import { createSMSProvider } from '../providers/sms'
import { renderDefinition } from '../templates/renderDefinition'

export const sendSMSNotification = async ({
  payload,
  input,
  options,
  rendered,
  fingerprint,
  templateSlug,
  templateVersion,
  renderDurationMs,
}: {
  payload: Payload
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  rendered?: RenderedNotificationContent
  fingerprint?: string
  templateSlug?: string
  templateVersion?: number
  renderDurationMs?: number
}): Promise<NotificationDispatchResult> => {
  // Delivery-based sends carry a resolved destination; legacy sends look up the user.
  const user = input.destination
    ? undefined
    : await payload.findByID({
        overrideAccess: true,
        collection: options.userCollectionSlug,
        id: input.userId,
      })
  const phone = input.destination ?? (user?.phone || user?.phoneNumber)

  if (!phone) {
    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'skipped',
      error: 'User phone not found for SMS delivery',
      fingerprint,
      failureClassification: 'terminal',
    })

    return {
      channel: 'sms',
      status: 'skipped',
      reason: 'User phone not found for SMS delivery',
    }
  }

  const context: NotificationTemplateContext = {
    event: input.event,
    userId: input.userId,
    payload: input.eventPayload,
  }

  const body = rendered?.body || renderDefinition({ body: input.template }, context).body

  const provider = createSMSProvider(options)

  try {
    const result = await provider.send({
      to: phone,
      template: body,
      context,
    })

    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'sent',
      fingerprint,
      provider: result.provider,
      providerMessageId: result.messageId,
      providerResponseRaw: result.response,
      templateSlug,
      templateVersion,
      renderDurationMs,
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

    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'failed',
      error: message,
      fingerprint,
      provider: options.providers.sms?.provider,
    })

    return {
      channel: 'sms',
      status: 'failed',
      reason: message,
      provider: options.providers.sms?.provider,
    }
  }
}
