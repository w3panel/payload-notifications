import type { Endpoint, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateContext,
} from '../types'
import { buildDataContext } from '../data/buildContext'
import { createSensitiveFieldMatcher, redactContext } from '../data/sensitive'
import { validateDataSources } from '../data/sources'
import { validateEventPayload } from '../events/registry'
import { finalizeForChannel } from '../templates/channelContent'
import { previewTemplateDoc } from '../templates/preview'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VALID_CHANNELS = new Set(['email', 'whatsapp', 'sms', 'inapp'])

type DataPreview = {
  context: Record<string, unknown>
  missing: string[]
}

/**
 * Resolves `sampleEvent` + `sources` like a real send, but with the caller's
 * access (`overrideAccess: false`). Returns the template context and a
 * redacted copy for the inspector, or an error response.
 */
const resolvePreviewData = async (
  req: PayloadRequest,
  body: Record<string, unknown>,
  fallback: NotificationTemplateContext,
  options: NormalizedNotificationsPluginOptions,
): Promise<
  | { ok: true; context: NotificationTemplateContext; preview: DataPreview }
  | { ok: false; response: Response }
> => {
  const sampleEvent = isObject(body.sampleEvent) ? body.sampleEvent : {}
  const name =
    typeof sampleEvent.name === 'string' && sampleEvent.name ? sampleEvent.name : fallback.event
  const definition = options.events[name]
  const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)

  const sources = body.sources ?? []
  const errors = validateDataSources(sources, {
    allowlist: options.data.collections,
    resolvers: Object.keys(options.dataResolvers),
    computed: Object.keys(options.computed),
    isSensitive,
    owner: 'preview',
  })
  if (errors.length) {
    return {
      ok: false,
      response: Response.json({ error: 'Invalid data sources', errors }, { status: 400 }),
    }
  }

  let eventPayload: Record<string, unknown> = isObject(sampleEvent.payload)
    ? sampleEvent.payload
    : fallback.payload && Object.keys(fallback.payload).length
      ? fallback.payload
      : (definition?.samplePayload ?? {})

  try {
    eventPayload = await validateEventPayload(name, definition, eventPayload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid sample payload'
    return { ok: false, response: Response.json({ error: message }, { status: 400 }) }
  }

  const result = await buildDataContext({
    payload: req.payload,
    req,
    overrideAccess: false,
    event: {
      name,
      eventId: 'evt_preview',
      occurredAt: new Date().toISOString(),
      userId: typeof sampleEvent.userId === 'string' ? sampleEvent.userId : fallback.userId,
      classification: definition?.classification,
      payload: eventPayload,
    },
    sources: sources as never,
    dataResolvers: options.dataResolvers,
    computed: options.computed,
    isSensitive,
    owner: 'preview',
  })

  if (!result.ok) {
    return {
      ok: false,
      response: Response.json(
        { error: result.message, reason: result.reason, source: result.source },
        { status: 422 },
      ),
    }
  }

  return {
    ok: true,
    context: result.context,
    preview: {
      context: redactContext(result.context, options.data.redact, isSensitive),
      missing: result.missing,
    },
  }
}

export const createTemplatePreviewHandler = (
  getOptions?: () => NormalizedNotificationsPluginOptions,
) => {
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

    let renderContext: NotificationTemplateContext = context
    let data: DataPreview | undefined

    if (body.sampleEvent !== undefined || body.sources !== undefined) {
      if (!getOptions) {
        return Response.json(
          { error: 'Data source preview requires plugin options' },
          { status: 400 },
        )
      }
      try {
        const resolved = await resolvePreviewData(req, body, context, getOptions())
        if (!resolved.ok) return resolved.response
        renderContext = resolved.context
        data = resolved.preview
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Data resolution failed'
        return Response.json({ error: message }, { status: 400 })
      }
    }

    try {
      const raw = previewTemplateDoc({
        doc,
        channel: channel as NotificationChannel,
        context: renderContext,
      })
      // Standalone collections (no plugin options) preview without channel finishing.
      let finishingOptions: NormalizedNotificationsPluginOptions | undefined
      try {
        finishingOptions = getOptions?.()
      } catch {
        finishingOptions = undefined
      }
      const rendered = finishingOptions
        ? await finalizeForChannel(raw, channel as NotificationChannel, finishingOptions)
        : raw
      return Response.json({ ok: true, channel, rendered, ...(data ? { data } : {}) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview failed'
      return Response.json({ error: message }, { status: 400 })
    }
  }
}

export const templatePreviewEndpoint = (
  path = '/preview',
  getOptions?: () => NormalizedNotificationsPluginOptions,
): Endpoint => ({
  path,
  method: 'post',
  handler: createTemplatePreviewHandler(getOptions),
})
