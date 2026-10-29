import type { Endpoint, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationAccessCheck,
  NotificationChannel,
  NotificationEvent,
  NotificationTemplateContext,
} from '../types'
import { isObject } from '../data/paths'
import { listDataFunctions } from '../data/resolvers'
import { createSensitiveFieldMatcher, redactContext } from '../data/sensitive'
import { evaluateTriggerPlan, recipientScopeOf } from '../deliveries/evaluate'
import { sendDelivery } from '../deliveries/send'
import { buildCollectionEvent } from '../events/collectionEvents'
import { generateEventId, listRegisteredEvents, validateEventPayload } from '../events/registry'
import { maskDestination, resolveRecipients } from '../recipients/resolve'
import { buildDefinitionFromTemplateDoc } from '../templates/fromDoc'
import { mergeTemplateDefinition, renderDefinition } from '../templates/renderDefinition'
import { resolveTemplate } from '../templates/resolve'
import { CONDITION_OPERATORS } from '../triggers/conditions'
import { OVERRIDABLE_FIELDS } from '../triggers/registry'
import { effectiveTriggerFor } from './validate'

type GetOptions = () => NormalizedNotificationsPluginOptions

const CHANNELS: NotificationChannel[] = ['email', 'sms', 'whatsapp', 'inapp']

const deny = (req: PayloadRequest) =>
  Response.json(
    { error: req.user ? 'Forbidden' : 'Unauthorized' },
    { status: req.user ? 403 : 401 },
  )

const guard = async (req: PayloadRequest, check: NotificationAccessCheck) =>
  Boolean(req.user) && (await check({ req }))

const readBody = async (req: PayloadRequest): Promise<Record<string, unknown> | undefined> => {
  try {
    const body = await req.json?.()
    return isObject(body) ? body : {}
  } catch {
    return undefined
  }
}

const describeAll = (registry: Record<string, { label?: string; description?: string }>) =>
  Object.entries(registry)
    .map(([name, definition]) => ({
      name,
      label: definition.label || name,
      description: definition.description,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

/** `GET /api/payload-notifications/registry` — everything the Trigger Builder's pickers offer. */
export const triggerRegistryEndpoint = (getOptions: GetOptions): Endpoint => ({
  path: '/payload-notifications/registry',
  method: 'get',
  handler: async (req) => {
    const options = getOptions()
    if (!(await guard(req, options.access.manageTriggers))) return deny(req)

    const dbTemplates = await req.payload.find({
      collection: options.collections.templates as never,
      limit: 500,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    const templates = [
      ...Object.entries(options.templates.registry).map(([slug, set]) => ({
        slug,
        source: 'code' as const,
        status: 'active',
        channels: CHANNELS.filter((channel) => Boolean(set[channel])),
      })),
      ...(dbTemplates.docs as Array<Record<string, unknown>>).map((doc) => ({
        slug: String(doc.slug),
        source: 'db' as const,
        status: String(doc.status ?? 'draft'),
        channels: CHANNELS.filter((channel) => {
          const definition = buildDefinitionFromTemplateDoc(doc as never, channel)
          return Boolean(definition.body || definition.htmlBody)
        }),
      })),
    ]

    return Response.json({
      channels: options.channels,
      classifications: ['transactional', 'marketing'],
      events: listRegisteredEvents(options),
      collections: Object.entries(options.data.collections).map(([slug, entry]) => ({
        slug,
        label: entry.label || slug,
        fields: entry.fields,
      })),
      collectionEvents: Object.entries(options.collectionEvents).map(([slug, config]) => ({
        slug,
        label: config.label || slug,
        operations: config.operations,
        capture: config.capture,
      })),
      ...listDataFunctions(options),
      recipientResolvers: describeAll(options.recipientResolvers),
      recipientQueries: describeAll(options.recipientQueries),
      conditions: describeAll(options.conditions),
      operators: CONDITION_OPERATORS,
      recipientTypes: [
        'eventUser',
        'context',
        'relationship',
        'static',
        'role',
        'resolver',
        'query',
      ],
      templates,
      quietHours: options.quietHours ?? null,
    })
  },
})

/** `GET /api/payload-notifications/code-triggers` — code triggers with policy and any admin override. */
export const codeTriggersEndpoint = (getOptions: GetOptions): Endpoint => ({
  path: '/payload-notifications/code-triggers',
  method: 'get',
  handler: async (req) => {
    const options = getOptions()
    if (!(await guard(req, options.access.manageTriggers))) return deny(req)

    const overrides = await req.payload.find({
      collection: options.collections.triggers as never,
      where: { overrides: { in: options.triggers.map((trigger) => trigger.slug) } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    const overrideOf = new Map(
      (overrides.docs as Array<Record<string, unknown>>)
        .filter((doc) => doc.status !== 'archived')
        .map((doc) => [String(doc.overrides), { id: doc.id, slug: doc.slug, status: doc.status }]),
    )

    return Response.json({
      triggers: options.triggers.map((trigger, index) => {
        const policy = trigger.admin?.policy ?? 'independent'
        return {
          slug: trigger.slug,
          name: trigger.name,
          description: trigger.description,
          origin: index < options.rules.length ? 'rule' : 'code',
          source: trigger.source,
          enabled: trigger.enabled !== false,
          policy,
          overridable:
            policy === 'managed' ? (trigger.admin?.overridable ?? OVERRIDABLE_FIELDS) : [],
          deliveries: trigger.deliveries.map(({ channel, template, recipient }) => ({
            channel,
            template,
            recipient,
          })),
          recipients: (trigger.recipients ?? [{ type: 'eventUser' }]).map(
            (recipient) => recipient.type,
          ),
          hasConditions: Boolean(trigger.conditions || trigger.condition),
          schedule: trigger.schedule?.type ?? 'immediate',
          override: overrideOf.get(trigger.slug) ?? null,
        }
      }),
    })
  },
})

const toJson = (value: unknown) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))

/**
 * `POST /api/payload-notifications/code-triggers/:slug/customize` — creates a
 * draft admin record that manages a `managed` code trigger, pre-filled with its
 * overridable fields.
 */
export const customizeCodeTriggerEndpoint = (getOptions: GetOptions): Endpoint => ({
  path: '/payload-notifications/code-triggers/:slug/customize',
  method: 'post',
  handler: async (req) => {
    const options = getOptions()
    if (!(await guard(req, options.access.manageTriggers))) return deny(req)

    const slug = String(req.routeParams?.slug ?? '')
    const trigger = options.triggers.find((candidate) => candidate.slug === slug)
    if (!trigger)
      return Response.json({ error: `Code trigger "${slug}" not found` }, { status: 404 })
    const policy = trigger.admin?.policy ?? 'independent'
    if (policy !== 'managed') {
      return Response.json(
        { error: `Code trigger "${slug}" is ${policy} and cannot be customized` },
        { status: 409 },
      )
    }

    const collection = options.collections.triggers as never
    const existing = await req.payload.find({
      collection,
      where: { and: [{ overrides: { equals: slug } }, { status: { not_equals: 'archived' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    const current = existing.docs?.[0] as { id: string | number } | undefined
    if (current) {
      return Response.json(
        { error: 'This trigger is already customized', id: current.id },
        { status: 409 },
      )
    }

    let recordSlug = `${slug}-custom`
    for (let attempt = 2; attempt < 50; attempt++) {
      const taken = await req.payload.find({
        collection,
        where: { slug: { equals: recordSlug } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        pagination: false,
      })
      if (!taken.docs?.length) break
      recordSlug = `${slug}-custom-${attempt}`
    }

    const data: Record<string, unknown> = {
      name: `${trigger.name || trigger.slug} (customized)`,
      slug: recordSlug,
      overrides: slug,
    }
    for (const field of trigger.admin?.overridable ?? OVERRIDABLE_FIELDS) {
      if (field === 'enabled') continue
      const value = toJson((trigger as Record<string, unknown>)[field])
      if (value !== undefined) data[field] = value
    }

    const created = (await req.payload.create({
      collection,
      data: data as never,
      overrideAccess: true,
    })) as { id: string | number }
    return Response.json({ id: created.id, slug: recordSlug }, { status: 201 })
  },
})

type RenderedPreview = {
  subject?: string
  title?: string
  text?: string
  html?: string
  error?: string
}

const renderPreview = async (
  options: NormalizedNotificationsPluginOptions,
  req: PayloadRequest,
  event: NotificationEvent,
  channel: NotificationChannel,
  template: string,
  overrides: Parameters<typeof mergeTemplateDefinition>[1],
  context: NotificationTemplateContext,
): Promise<RenderedPreview> => {
  try {
    const resolved = await resolveTemplate({
      event: event.name,
      channel,
      templateKey: template,
      options,
      payload: req.payload,
    })
    const rendered = renderDefinition(
      mergeTemplateDefinition(resolved.definition, overrides),
      context,
    )
    return {
      subject: rendered.subject,
      title: rendered.title,
      text: rendered.text,
      html: rendered.html,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Builds the event a test run uses: a registered event's sample payload (or
 * the given one), or — for collection triggers — a real document.
 */
const buildTestEvent = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  trigger: NonNullable<ReturnType<typeof effectiveTriggerFor>['trigger']>,
  body: Record<string, unknown>,
): Promise<{ event: NotificationEvent } | { error: string; status: number }> => {
  const sample = isObject(body.sampleEvent) ? body.sampleEvent : {}
  const eventId = `evt_test_${generateEventId().slice(4)}`

  if (trigger.source.type === 'collection') {
    const documentId = body.documentId
    if (typeof documentId !== 'string' && typeof documentId !== 'number') {
      return { error: 'documentId is required to test a collection trigger', status: 400 }
    }
    const doc = await req.payload.findByID({
      collection: trigger.source.collection as never,
      id: documentId,
      depth: 0,
      overrideAccess: false,
      req,
      disableErrors: true,
    })
    if (!isObject(doc)) return { error: 'Document not found', status: 404 }
    const config = options.collectionEvents[trigger.source.collection]
    if (!config) return { error: 'Collection is not configured in collectionEvents', status: 400 }
    const previousDoc = isObject(sample.previous) ? { ...doc, ...sample.previous } : doc
    const event = buildCollectionEvent({
      collection: trigger.source.collection,
      config: { ...config, onlyWhenCaptureChanges: false },
      operation: trigger.source.operation,
      doc,
      previousDoc: trigger.source.operation === 'update' ? previousDoc : undefined,
      tenancyField: options.tenancy?.field,
    })
    if (!event) return { error: 'Could not build a collection event', status: 400 }
    return { event: { ...event, eventId, occurredAt: new Date().toISOString() } }
  }

  const pattern = trigger.source.event
  const name = typeof sample.name === 'string' && sample.name ? sample.name : pattern
  if (name.includes('*')) {
    return { error: 'sampleEvent.name is required for wildcard triggers', status: 400 }
  }
  const definition = options.events[name]
  try {
    const payload = await validateEventPayload(
      name,
      definition,
      isObject(sample.payload) ? sample.payload : (definition?.samplePayload ?? {}),
    )
    return {
      event: {
        name,
        eventId,
        occurredAt: new Date().toISOString(),
        userId: typeof sample.userId === 'string' ? sample.userId : undefined,
        classification: definition?.classification,
        payload,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 400 }
  }
}

/**
 * `POST /api/payload-notifications/triggers/test` with `{ doc, sampleEvent?,
 * documentId?, send? }` — dry-runs a trigger definition (unsaved form values
 * allowed) and returns the redacted context, recipients and rendered output per
 * delivery. With `send: true`, sends each channel once to the **current
 * admin only**, as `test` deliveries with unique keys.
 */
export const triggerTestEndpoint = (getOptions: GetOptions): Endpoint => ({
  path: '/payload-notifications/triggers/test',
  method: 'post',
  handler: async (req) => {
    const options = getOptions()
    const body = await readBody(req)
    if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    const send = body.send === true
    if (!(await guard(req, send ? options.access.testSend : options.access.manageTriggers))) {
      return deny(req)
    }
    if (!isObject(body.doc)) return Response.json({ error: 'doc is required' }, { status: 400 })

    const effective = effectiveTriggerFor(body.doc, options)
    if (!effective.trigger) {
      return Response.json({ error: 'Invalid trigger', errors: effective.errors }, { status: 400 })
    }
    const trigger = { ...effective.trigger, enabled: true }

    const built = await buildTestEvent(req, options, trigger, body)
    if ('error' in built) return Response.json({ error: built.error }, { status: built.status })
    const { event } = built

    const isSensitive = createSensitiveFieldMatcher(options.data.sensitiveFields)
    const plan = await evaluateTriggerPlan({
      payload: req.payload,
      event,
      trigger,
      options,
      isSensitive,
      req,
      lookups: { req, overrideAccess: false },
    })

    const eventSummary = {
      name: event.name,
      eventId: event.eventId,
      payload: redactContext(event.payload ?? {}, [], isSensitive),
    }
    if (!plan.ok) {
      return Response.json({
        ok: true,
        matched: false,
        event: eventSummary,
        outcome: plan.outcome,
        reason: plan.reason,
        warnings: plan.outcome === 'not-matched' ? [] : plan.warnings,
      })
    }

    // Previews render from the redacted context so masked values stay masked.
    const redacted = redactContext(plan.context, options.data.redact, isSensitive)
    const deliveries = await Promise.all(
      plan.items.map(async (item) => ({
        channel: item.delivery.channel,
        template: item.delivery.template,
        recipientKey: item.recipient.key,
        destinationMasked: maskDestination(item.destination) ?? null,
        sendAt: item.sendAt?.toISOString() ?? null,
        rendered: await renderPreview(
          options,
          req,
          event,
          item.delivery.channel,
          item.delivery.template,
          item.delivery.templateOverrides,
          { ...redacted, recipient: item.recipientScope },
        ),
      })),
    )

    const response: Record<string, unknown> = {
      ok: true,
      matched: true,
      event: eventSummary,
      context: redacted,
      missing: plan.missing,
      warnings: plan.warnings,
      recipients: plan.recipients.map((recipient) => ({
        key: recipient.key,
        aliases: recipient.aliases,
        name: recipient.name,
        destinations: Object.fromEntries(
          Object.entries(recipient.destinations).map(([channel, value]) => [
            channel,
            maskDestination(value),
          ]),
        ),
      })),
      deliveries,
    }

    if (!send) return Response.json(response)

    // Test send: one message per channel + template, to the current admin only.
    const admin = await resolveRecipients({
      payload: req.payload,
      event: { ...event, userId: String((req.user as { id: string | number }).id) },
      context: plan.context,
      definitions: [{ type: 'eventUser', alias: 'admin' }],
      options,
      owner: 'test send',
    })
    const recipient = admin.recipients[0]
    if (!recipient) {
      return Response.json({
        ...response,
        sent: [],
        error: 'Your user has no notification destinations',
      })
    }

    const unique = new Map(
      plan.items.map((item) => [`${item.delivery.channel}::${item.delivery.template}`, item]),
    )
    const sent = []
    for (const item of unique.values()) {
      const channel = item.delivery.channel
      const destination = recipient.destinations[channel as keyof typeof recipient.destinations]
      if (!destination) {
        sent.push({
          channel,
          template: item.delivery.template,
          status: 'skipped',
          reason: `You have no ${channel} destination`,
        })
        continue
      }
      const created = (await req.payload.create({
        collection: options.collections.deliveries as never,
        overrideAccess: true,
        data: {
          event: event.name,
          eventId: event.eventId,
          trigger: trigger.slug,
          triggerOrigin: 'admin',
          triggerVersion: Number(body.doc.version) || 0,
          triggerPolicy: 'test',
          channel,
          templateSlug: item.delivery.template,
          status: 'queued',
          attempts: 0,
          recipientKey: recipient.key,
          recipientId: recipient.recipientId,
          recipientAlias: 'admin',
          destination,
          destinationMasked: maskDestination(destination),
          classification: plan.classification,
          idempotencyKey: `test::${event.eventId}::${channel}::${item.delivery.template}`,
          test: true,
          context: { ...plan.context, recipient: recipientScopeOf(recipient) },
          templateOverrides: item.delivery.templateOverrides,
        } as never,
      })) as { id: string | number }
      const result = await sendDelivery({
        payload: req.payload,
        options,
        input: {
          deliveryId: String(created.id),
          userId: recipient.recipientId ?? '',
          channel,
          template: item.delivery.template,
          event: event.name,
        },
      })
      sent.push({ ...result, channel, template: item.delivery.template, deliveryId: created.id })
    }

    return Response.json({ ...response, sent })
  },
})

/** Root endpoints for the admin Trigger Builder. */
export const adminTriggerRootEndpoints = (getOptions: GetOptions): Endpoint[] => [
  triggerRegistryEndpoint(getOptions),
  codeTriggersEndpoint(getOptions),
  customizeCodeTriggerEndpoint(getOptions),
  triggerTestEndpoint(getOptions),
]
