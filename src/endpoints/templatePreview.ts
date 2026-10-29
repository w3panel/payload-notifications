import type { Endpoint, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationEvent,
  NotificationTemplateContext,
} from '../types'
import { effectiveTriggerFor } from '../admin-triggers/validate'
import { buildCollectionEvent } from '../events/collectionEvents'
import { auditEmail } from '../studio/audit'
import { compileDesign, type EmailTheme } from '../studio/compile'
import { parseDesign, type EmailDesign } from '../studio/model'
import { loadDesignResources } from '../studio/resources'
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
  /** A prepared event (real document samples); replaces `sampleEvent`. */
  preparedEvent?: NotificationEvent,
): Promise<
  | { ok: true; context: NotificationTemplateContext; preview: DataPreview }
  | { ok: false; response: Response }
> => {
  const sampleEvent = isObject(body.sampleEvent) ? body.sampleEvent : {}
  const name = preparedEvent
    ? preparedEvent.name
    : typeof sampleEvent.name === 'string' && sampleEvent.name
      ? sampleEvent.name
      : fallback.event
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

  let eventPayload: Record<string, unknown> = preparedEvent
    ? ((preparedEvent.payload ?? {}) as Record<string, unknown>)
    : isObject(sampleEvent.payload)
      ? sampleEvent.payload
      : fallback.payload && Object.keys(fallback.payload).length
        ? fallback.payload
        : (definition?.samplePayload ?? {})

  if (!preparedEvent) {
    try {
      eventPayload = await validateEventPayload(name, definition, eventPayload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid sample payload'
      return { ok: false, response: Response.json({ error: message }, { status: 400 }) }
    }
  }

  const result = await buildDataContext({
    payload: req.payload,
    req,
    overrideAccess: false,
    event: preparedEvent ?? {
      name,
      eventId: 'evt_preview',
      occurredAt: new Date().toISOString(),
      userId: typeof sampleEvent.userId === 'string' ? sampleEvent.userId : fallback.userId,
      classification: definition?.classification,
      payload: eventPayload,
    },
    ...(preparedEvent?.doc !== undefined ? { doc: preparedEvent.doc } : {}),
    ...(preparedEvent?.previous !== undefined ? { previous: preparedEvent.previous } : {}),
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

type PreviewSample =
  | {
      sampleEvent?: Record<string, unknown>
      sources?: unknown[]
      event?: NotificationEvent
    }
  | { error: string; status: number }

/** Loads a real document of a `collectionEvents` collection as a collection event. */
const documentEvent = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  collection: unknown,
  id: unknown,
): Promise<{ event: NotificationEvent } | { error: string; status: number }> => {
  if (typeof collection !== 'string' || !options.collectionEvents[collection]) {
    return {
      error: `Collection "${String(collection)}" is not configured in collectionEvents`,
      status: 400,
    }
  }
  if (typeof id !== 'string' && typeof id !== 'number') {
    return { error: 'A document id is required', status: 400 }
  }
  const doc = await req.payload.findByID({
    collection: collection as never,
    id,
    depth: 0,
    overrideAccess: false,
    req,
    disableErrors: true,
  })
  if (!isObject(doc)) return { error: 'Document not found', status: 404 }
  const event = buildCollectionEvent({
    collection,
    config: { ...options.collectionEvents[collection], onlyWhenCaptureChanges: false },
    operation: 'update',
    doc,
    previousDoc: doc,
    tenancyField: options.tenancy?.field,
  })
  if (!event) return { error: 'Could not build an event from the document', status: 400 }
  return { event: { ...event, eventId: 'evt_preview', occurredAt: new Date().toISOString() } }
}

/**
 * Sample data for previews: `{ kind: 'event' }` (the event's sample payload),
 * `{ kind: 'document', collection, id }` (a real document, read with the
 * caller's access) or `{ kind: 'trigger', trigger, documentId? }` (the
 * trigger's event and data sources).
 */
const resolvePreviewSample = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  sample: Record<string, unknown>,
  event: string,
): Promise<PreviewSample> => {
  switch (sample.kind) {
    case 'event':
      return {
        sampleEvent: {
          name: typeof sample.event === 'string' && sample.event ? sample.event : event,
        },
      }
    case 'document':
      return documentEvent(req, options, sample.collection, sample.id)
    case 'trigger': {
      const slug = typeof sample.trigger === 'string' ? sample.trigger : ''
      let trigger = options.triggers.find((entry) => entry.slug === slug)
      if (!trigger && slug) {
        const found = await req.payload.find({
          collection: options.collections.triggers as never,
          where: { slug: { equals: slug } },
          limit: 1,
          depth: 0,
          overrideAccess: false,
          req,
        })
        const doc = found.docs?.[0] as Record<string, unknown> | undefined
        trigger = doc ? effectiveTriggerFor(doc, options).trigger : undefined
      }
      if (!trigger) return { error: `Trigger "${slug}" not found`, status: 404 }
      const sources = trigger.data?.sources ?? []
      if (trigger.source.type === 'collection') {
        const loaded = await documentEvent(
          req,
          options,
          trigger.source.collection,
          sample.documentId,
        )
        return 'error' in loaded ? loaded : { event: loaded.event, sources }
      }
      if (trigger.source.event.includes('*')) {
        return { error: 'Wildcard triggers need an event sample instead', status: 400 }
      }
      return { sampleEvent: { name: trigger.source.event }, sources }
    }
    default:
      return { error: 'sample.kind must be event, document or trigger', status: 400 }
  }
}

/** Compiles an unsaved visual design (form values) for preview. */
export const compileVisualPreview = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  doc: Record<string, unknown>,
): Promise<
  | { doc?: Record<string, unknown>; design?: EmailDesign; theme?: EmailTheme }
  | { error: string; errors: string[] }
> => {
  const email = isObject(doc.email) ? doc.email : undefined
  if (!email || email.editor !== 'visual' || !email.design) return {}
  const parsed = parseDesign(email.design)
  if (!parsed.ok) return { error: 'The email design is invalid', errors: parsed.errors }
  const resources = await loadDesignResources({ design: parsed.design, req, options })
  const locale = typeof doc.locale === 'string' && doc.locale ? doc.locale : undefined
  const compiled = compileDesign(parsed.design, {
    ...resources,
    ...(locale ? { lang: locale } : {}),
  })
  return {
    doc: { ...doc, email: { ...email, htmlBody: compiled.html, textBody: compiled.text } },
    design: parsed.design,
    theme: resources.theme,
  }
}

/**
 * The render context for previews and test sends: the JSON `context`, or the
 * chosen `sample` / `sampleEvent` + `sources` resolved like a real send.
 */
export const buildPreviewContext = async (
  req: PayloadRequest,
  body: Record<string, unknown>,
  doc: Record<string, unknown>,
  getOptions?: () => NormalizedNotificationsPluginOptions,
): Promise<
  | { ok: true; context: NotificationTemplateContext; data?: DataPreview }
  | { ok: false; response: Response }
> => {
  const fail = (error: string, status = 400) => ({
    ok: false as const,
    response: Response.json({ error }, { status }),
  })
  const contextInput = isObject(body.context) ? body.context : {}
  const context: NotificationTemplateContext = {
    event:
      typeof contextInput.event === 'string'
        ? contextInput.event
        : typeof doc.slug === 'string'
          ? doc.slug
          : 'preview',
    userId: typeof contextInput.userId === 'string' ? contextInput.userId : 'preview-user',
    // `{ payload: {...} }`, or the shorthand `{ orderId: '1' }` → payload.orderId
    payload: isObject(contextInput.payload)
      ? contextInput.payload
      : (Object.fromEntries(
          Object.entries(contextInput).filter(
            ([key]) => !['event', 'userId', 'payload'].includes(key),
          ),
        ) as Record<string, unknown>),
  }

  let preparedEvent: NotificationEvent | undefined
  let sampleEvent = body.sampleEvent
  let sources = body.sources
  if (isObject(body.sample)) {
    if (!getOptions) return fail('Sample data requires plugin options')
    const sample = await resolvePreviewSample(req, getOptions(), body.sample, context.event)
    if ('error' in sample) return fail(sample.error, sample.status)
    sampleEvent = sample.sampleEvent ?? {}
    sources = sample.sources ?? []
    preparedEvent = sample.event
    // The chosen sample replaces the JSON context's payload.
    context.payload = {}
  }

  if (sampleEvent === undefined && sources === undefined) return { ok: true, context }
  if (!getOptions) return fail('Data source preview requires plugin options')
  try {
    const resolved = await resolvePreviewData(
      req,
      { ...body, sampleEvent, sources },
      context,
      getOptions(),
      preparedEvent,
    )
    if (!resolved.ok) return { ok: false, response: resolved.response }
    return { ok: true, context: resolved.context, data: resolved.preview }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Data resolution failed')
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

    const built = await buildPreviewContext(req, body, doc, getOptions)
    if (!built.ok) return built.response
    const { context: renderContext, data } = built

    // Visual designs are compiled from the unsaved form values.
    let design: EmailDesign | undefined
    let theme: EmailTheme | undefined
    let previewDoc = doc
    if (channel === 'email' && getOptions) {
      const visual = await compileVisualPreview(req, getOptions(), doc)
      if ('error' in visual)
        return Response.json({ error: visual.error, errors: visual.errors }, { status: 400 })
      if (visual.doc) {
        previewDoc = visual.doc
        design = visual.design
        theme = visual.theme
      }
    }

    try {
      const raw = previewTemplateDoc({
        doc: previewDoc,
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
      const checks =
        channel === 'email' && rendered.html
          ? auditEmail({ html: rendered.html, design, theme })
          : undefined
      return Response.json({
        ok: true,
        channel,
        rendered,
        ...(data ? { data } : {}),
        ...(checks ? { checks } : {}),
      })
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
