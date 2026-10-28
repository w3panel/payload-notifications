import type { Endpoint, PayloadRequest } from 'payload'
import type { NotificationChannel, NotificationTemplateContext } from '../types'
import { previewTemplateDoc } from '../templates/preview'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VALID_CHANNELS = new Set(['email', 'whatsapp', 'sms', 'inapp'])

export const createTemplatePreviewHandler = () => {
  return async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    const doc = isObject(body.doc) ? body.doc : isObject(body.data) ? body.data : null
    if (!doc) {
      return Response.json({ error: 'doc (template field values) is required' }, { status: 400 })
    }

    const contextInput = isObject(body.context) ? body.context : {}
    const context: NotificationTemplateContext = {
      event:
        typeof contextInput.event === 'string'
          ? contextInput.event
          : typeof doc.slug === 'string'
            ? doc.slug
            : 'preview',
      userId: typeof contextInput.userId === 'string' ? contextInput.userId : 'preview-user',
      payload: isObject(contextInput.payload)
        ? contextInput.payload
        : isObject(contextInput)
          ? (Object.fromEntries(
              Object.entries(contextInput).filter(
                ([key]) => !['event', 'userId', 'payload'].includes(key),
              ),
            ) as Record<string, unknown>)
          : {},
    }

    // Prefer nested payload when provided as context.payload
    if (isObject(contextInput.payload)) {
      context.payload = contextInput.payload
    } else if (!context.payload || !Object.keys(context.payload).length) {
      // Allow shorthand: { context: { orderId: '1' } } → payload.orderId
      const rest = { ...contextInput }
      delete rest.event
      delete rest.userId
      delete rest.payload
      context.payload = rest
    }

    try {
      const rendered = previewTemplateDoc({
        doc,
        channel: channel as NotificationChannel,
        context,
      })
      return Response.json({ ok: true, channel, rendered })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed'
      return Response.json({ error: message }, { status: 400 })
    }
  }
}

export const templatePreviewEndpoint = (path = '/preview'): Endpoint => ({
  path,
  method: 'post',
  handler: createTemplatePreviewHandler(),
})
