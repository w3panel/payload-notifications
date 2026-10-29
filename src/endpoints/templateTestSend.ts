import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationSendInput,
} from '../types'
import { sendEmailNotification } from '../channels/email'
import { sendInAppNotification } from '../channels/inapp'
import { sendSMSNotification } from '../channels/sms'
import { sendWhatsAppNotification } from '../channels/whatsapp'
import { writeNotificationLog } from '../jobs/writeLog'
import { buildDefinitionFromTemplateDoc } from '../templates/fromDoc'
import { renderDefinition } from '../templates/renderDefinition'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VALID_CHANNELS = new Set(['email', 'whatsapp', 'sms', 'inapp'])

export const createTemplateTestSendHandler = (
  getOptions: () => NormalizedNotificationsPluginOptions,
) => {
  return async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const options = getOptions()
    if (!(await options.access.testSend({ req }))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const payload = req.payload as Payload

    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!isObject(body)) {
      return Response.json({ error: 'Body must be an object' }, { status: 400 })
    }

    const channel = body.channel
    if (typeof channel !== 'string' || !VALID_CHANNELS.has(channel)) {
      return Response.json({ error: 'Valid channel is required' }, { status: 400 })
    }

    const templateId = body.id ?? body.templateId
    let doc: Record<string, unknown> | null = isObject(body.doc) ? body.doc : null

    if (!doc && (typeof templateId === 'string' || typeof templateId === 'number')) {
      const found = await payload.findByID({
        collection: options.collections.templates,
        id: templateId,
        overrideAccess: true,
      })
      doc = found as unknown as Record<string, unknown>
    }

    if (!doc) {
      return Response.json({ error: 'doc or template id is required' }, { status: 400 })
    }

    const userId =
      typeof body.userId === 'string' && body.userId.trim()
        ? body.userId.trim()
        : typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
          ? String(req.user.id)
          : ''

    if (!userId) {
      return Response.json({ error: 'userId is required for test send' }, { status: 400 })
    }

    const slug = typeof doc.slug === 'string' ? doc.slug : 'test-template'
    const definition = buildDefinitionFromTemplateDoc(doc, channel as NotificationChannel)
    const context = {
      event: slug,
      userId,
      payload: isObject(body.context) ? body.context : {},
    }
    const rendered = renderDefinition(definition, context)

    const input: NotificationSendInput = {
      userId,
      channel: channel as NotificationChannel,
      template: slug,
      event: slug,
      eventPayload: context.payload,
      classification: 'transactional',
      idempotencyKey: `test-send:${slug}:${channel}:${userId}:${Date.now()}`,
    }

    let result
    switch (channel) {
      case 'email':
        result = await sendEmailNotification({
          payload,
          input,
          options,
          rendered,
        })
        break
      case 'sms':
        result = await sendSMSNotification({
          payload,
          input,
          options,
          rendered,
        })
        break
      case 'whatsapp':
        result = await sendWhatsAppNotification({
          payload,
          input,
          options,
          rendered,
        })
        break
      case 'inapp':
        result = await sendInAppNotification({
          payload,
          input,
          options,
          rendered,
        })
        break
      default:
        return Response.json({ error: `Unsupported channel: ${channel}` }, { status: 400 })
    }

    // Ensure test-send is visible in logs even when channel already wrote a row
    if (result.status === 'sent' || result.status === 'stored' || result.status === 'skipped') {
      try {
        await writeNotificationLog({
          payload,
          options,
          input,
          status: result.status,
          error: result.reason,
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          meta: { testSend: true },
        })
      } catch {
        // Channel may have already logged; meta.testSend is best-effort
      }
    }

    return Response.json({ ok: true, result })
  }
}

export const templateTestSendEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  path = '/test-send',
): Endpoint => ({
  path,
  method: 'post',
  handler: createTemplateTestSendHandler(getOptions),
})
