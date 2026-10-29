import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationSendInput,
  RenderedNotificationContent,
} from '../types'
import { sendEmailNotification } from '../channels/email'
import { sendInAppNotification } from '../channels/inapp'
import { sendSMSNotification } from '../channels/sms'
import { sendWhatsAppNotification } from '../channels/whatsapp'
import { writeNotificationLog } from '../jobs/writeLog'
import { finalizeForChannel } from '../templates/channelContent'
import { buildDefinitionFromTemplateDoc } from '../templates/fromDoc'
import { buildPreviewContext, compileVisualPreview } from './templatePreview'
import { renderDefinition } from '../templates/renderDefinition'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VALID_CHANNELS = new Set(['email', 'whatsapp', 'sms', 'inapp'])

/** Prefix that marks test sends. */
export const TEST_SEND_PREFIX = '[Test] '

/**
 * Marks rendered content as a test: subject / title, and the text of SMS and
 * plain WhatsApp messages (approved WhatsApp templates cannot be changed).
 */
export const markAsTest = <T extends RenderedNotificationContent>(
  rendered: T,
  channel: NotificationChannel,
): T => {
  const prefix = (value: string | undefined) =>
    value && !value.startsWith(TEST_SEND_PREFIX) ? `${TEST_SEND_PREFIX}${value}` : value
  switch (channel) {
    case 'email':
      return { ...rendered, subject: prefix(rendered.subject) ?? TEST_SEND_PREFIX.trim() }
    case 'inapp':
      return rendered.title
        ? { ...rendered, title: prefix(rendered.title) }
        : { ...rendered, body: prefix(rendered.body) ?? '', text: prefix(rendered.text) ?? '' }
    case 'sms':
    case 'whatsapp':
      return rendered.whatsappTemplate
        ? rendered
        : { ...rendered, body: prefix(rendered.body) ?? '', text: prefix(rendered.text) ?? '' }
    default:
      return rendered
  }
}

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

    // Test sends only go to the signed-in admin.
    const userId =
      typeof req.user.id === 'string' || typeof req.user.id === 'number' ? String(req.user.id) : ''
    if (!userId) {
      return Response.json({ error: 'Test sends need a signed-in user' }, { status: 400 })
    }
    if (body.userId !== undefined && body.userId !== null && String(body.userId) !== userId) {
      return Response.json({ error: 'Test sends go to your own account only' }, { status: 400 })
    }

    const slug = typeof doc.slug === 'string' ? doc.slug : 'test-template'
    // Same content as the preview: unsaved visual designs and the chosen sample data.
    let sendDoc = doc
    if (channel === 'email') {
      const visual = await compileVisualPreview(req, options, doc)
      if ('error' in visual) {
        return Response.json({ error: visual.error, errors: visual.errors }, { status: 400 })
      }
      if (visual.doc) sendDoc = visual.doc
    }
    const built = await buildPreviewContext(req, body, doc, () => options)
    if (!built.ok) return built.response
    const context = { ...built.context, event: built.context.event || slug, userId }
    const definition = buildDefinitionFromTemplateDoc(sendDoc, channel as NotificationChannel)
    // Finished like a real send (links, preheader, layout, SMS link shortening).
    const rendered = markAsTest(
      await finalizeForChannel(
        renderDefinition(definition, context),
        channel as NotificationChannel,
        options,
      ),
      channel as NotificationChannel,
    )

    const input: NotificationSendInput = {
      userId,
      channel: channel as NotificationChannel,
      template: slug,
      event: slug,
      eventPayload: context.payload ?? {},
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
