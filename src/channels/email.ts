import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDispatchResult,
  NotificationSendInput,
  RenderedNotificationContent,
} from '../types'
import { writeNotificationLog } from '../jobs/writeLog'
import { renderTemplate } from '../templates/render'

export const sendEmailNotification = async ({
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
  const user = await payload.findByID({
    overrideAccess: true,
    collection: options.userCollectionSlug,
    id: input.userId,
  })

  if (!user?.email) {
    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'skipped',
      error: 'User email not found',
      fingerprint,
      failureClassification: 'terminal',
    })

    return {
      channel: 'email',
      status: 'skipped',
      reason: 'User email not found',
    }
  }

  let content = rendered

  if (!content) {
    try {
      const legacy = await renderTemplate(input.template, {
        event: input.event,
        userId: input.userId,
        payload: input.eventPayload,
      })
      content = {
        subject: legacy.subject,
        body: legacy.text || input.template,
        text: legacy.text || input.template,
        html: legacy.html || `<p>${input.template}</p>`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Template rendering failed'

      await writeNotificationLog({
        payload,
        options,
        input,
        status: 'failed',
        error: message,
        fingerprint,
        failureClassification: 'terminal',
        provider: 'payload-email',
      })

      return {
        channel: 'email',
        status: 'failed',
        reason: message,
        provider: 'payload-email',
      }
    }
  }

  try {
    await payload.sendEmail({
      to: user.email,
      subject: content.subject || `Notification: ${input.event}`,
      html: content.html || `<p>${content.text || content.body}</p>`,
      text: content.text || content.body,
      from: options.providers.email?.defaultFromAddress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed'

    await writeNotificationLog({
      payload,
      options,
      input,
      status: 'failed',
      error: message,
      fingerprint,
      failureClassification: undefined,
      provider: 'payload-email',
    })

    return {
      channel: 'email',
      status: 'failed',
      reason: message,
      provider: 'payload-email',
    }
  }

  await writeNotificationLog({
    payload,
    options,
    input,
    status: 'sent',
    fingerprint,
    provider: 'payload-email',
    templateSlug,
    templateVersion,
    renderDurationMs,
    providerResponseRaw: { subject: content.subject },
  })

  return {
    channel: 'email',
    status: 'sent',
    provider: 'payload-email',
    response: { subject: content.subject },
  }
}
