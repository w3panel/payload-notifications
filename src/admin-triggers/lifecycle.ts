import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { definitionOf, DEFINITION_FIELDS, type TriggerDefinitionFields } from './record'
import type { AdminTriggerCache } from './store'
import { validateAdminTrigger, type TriggerValidationReport } from './validate'

export const LIFECYCLE_ACTIONS = [
  'validate',
  'publish',
  'enable',
  'disable',
  'archive',
  'rollback',
] as const
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number]

type TriggerDoc = Record<string, unknown> & {
  id: string | number
  slug: string
  name?: string
  status?: string
  version?: number
}

/** Cancels queued deliveries of a trigger (used on disable / archive when configured). */
export const cancelQueuedDeliveries = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  slug: string,
  reason: string,
): Promise<number> => {
  const result = await payload.update({
    collection: options.collections.deliveries as never,
    where: { and: [{ trigger: { equals: slug } }, { status: { equals: 'queued' } }] },
    data: { status: 'cancelled', skipReason: reason } as never,
    overrideAccess: true,
  })
  return (result as { docs?: unknown[] }).docs?.length ?? 0
}

export type LifecycleResult = {
  status: number
  body: {
    ok: boolean
    error?: string
    report?: TriggerValidationReport
    doc?: Record<string, unknown>
    cancelled?: number
  }
}

/**
 * Applies a lifecycle action to an admin trigger:
 * - validate: stores the report; a clean draft becomes `validated`
 * - publish: validates, snapshots the definition as version N+1, makes it live
 * - enable: re-activates a disabled trigger's current published version
 * - disable / archive: stops matching (optionally cancelling queued deliveries)
 * - rollback: copies version `version`'s definition back and publishes it as a new version
 */
export const runLifecycleAction = async ({
  payload,
  options,
  id,
  action,
  version,
  user,
  cache,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  id: string | number
  action: LifecycleAction
  version?: number
  user?: { id: string | number } | null
  cache?: AdminTriggerCache
}): Promise<LifecycleResult> => {
  const collection = options.collections.triggers as never
  const doc = (await payload.findByID({
    collection,
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as TriggerDoc | null
  if (!doc) return { status: 404, body: { ok: false, error: 'Trigger not found' } }

  const update = async (data: Record<string, unknown>) =>
    (await payload.update({ collection, id, data: data as never, overrideAccess: true })) as Record<
      string,
      unknown
    >

  const publish = async (source: TriggerDoc): Promise<LifecycleResult> => {
    const report = await validateAdminTrigger({ payload, doc: source, options })
    if (!report.ok) {
      await update({ validation: report })
      return { status: 422, body: { ok: false, error: 'Validation failed', report } }
    }
    const nextVersion = (Number(doc.version) || 0) + 1
    const now = new Date().toISOString()
    await payload.create({
      collection: options.collections.triggerVersions as never,
      overrideAccess: true,
      data: {
        trigger: doc.id,
        slug: doc.slug,
        name: doc.name,
        version: nextVersion,
        definition: definitionOf(source),
        publishedAt: now,
        ...(user ? { publishedBy: user.id } : {}),
      } as never,
    })
    const updated = await update({
      ...definitionPatch(definitionOf(source)),
      status: 'published',
      version: nextVersion,
      publishedAt: now,
      ...(user ? { publishedBy: user.id } : {}),
      hasUnpublishedChanges: false,
      validation: report,
    })
    cache?.invalidate()
    return { status: 200, body: { ok: true, report, doc: updated } }
  }

  switch (action) {
    case 'validate': {
      const report = await validateAdminTrigger({ payload, doc, options })
      const updated = await update({
        validation: report,
        ...(report.ok && doc.status === 'draft' ? { status: 'validated' } : {}),
      })
      return { status: 200, body: { ok: report.ok, report, doc: updated } }
    }

    case 'publish':
      if (doc.status === 'archived') {
        return { status: 409, body: { ok: false, error: 'Archived triggers cannot be published' } }
      }
      return publish(doc)

    case 'enable': {
      if (doc.status !== 'disabled' || !doc.version) {
        return {
          status: 409,
          body: { ok: false, error: 'Only disabled, previously published triggers can be enabled' },
        }
      }
      const updated = await update({ status: 'published' })
      cache?.invalidate()
      return { status: 200, body: { ok: true, doc: updated } }
    }

    case 'disable':
    case 'archive': {
      const nextStatus = action === 'disable' ? 'disabled' : 'archived'
      if (action === 'disable' && doc.status !== 'published') {
        return {
          status: 409,
          body: { ok: false, error: 'Only published triggers can be disabled' },
        }
      }
      const updated = await update({ status: nextStatus })
      cache?.invalidate()
      const cancelled = options.adminTriggers.cancelQueuedOnDisable
        ? await cancelQueuedDeliveries(payload, options, doc.slug, `Trigger ${nextStatus}`)
        : 0
      return { status: 200, body: { ok: true, doc: updated, cancelled } }
    }

    case 'rollback': {
      if (!Number.isInteger(version) || !version) {
        return { status: 400, body: { ok: false, error: 'version is required' } }
      }
      const snapshots = await payload.find({
        collection: options.collections.triggerVersions as never,
        where: { and: [{ trigger: { equals: doc.id } }, { version: { equals: version } }] },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        pagination: false,
      })
      const snapshot = snapshots.docs?.[0] as { definition?: TriggerDefinitionFields } | undefined
      if (!snapshot?.definition) {
        return { status: 404, body: { ok: false, error: `Version ${version} not found` } }
      }
      return publish({ ...doc, ...definitionPatch(snapshot.definition) })
    }
  }
}

/** Definition fields to write back on a document (missing fields are cleared). */
const definitionPatch = (definition: TriggerDefinitionFields): Record<string, unknown> =>
  Object.fromEntries(
    DEFINITION_FIELDS.map((field) => [
      field,
      (definition as Record<string, unknown>)[field] ?? null,
    ]),
  )

/** `POST /api/<triggers>/:id/lifecycle` with `{ action, version? }`. */
export const triggerLifecycleEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  cache?: AdminTriggerCache,
): Endpoint => ({
  path: '/:id/lifecycle',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    const options = getOptions()
    // Anonymous requests are refused before the body is read.
    if (!req.user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    let body: Record<string, unknown> = {}
    try {
      body = ((await req.json?.()) as Record<string, unknown>) ?? {}
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }
    const action = body.action as LifecycleAction
    if (!LIFECYCLE_ACTIONS.includes(action)) {
      return Response.json(
        { ok: false, error: `Unknown action "${String(body.action)}"` },
        { status: 400 },
      )
    }

    const allowed =
      action === 'validate'
        ? await options.access.manageTriggers({ req })
        : await options.access.publishTriggers({ req })
    if (!req.user || !allowed) {
      return Response.json({ ok: false, error: 'Forbidden' }, { status: req.user ? 403 : 401 })
    }

    const id = req.routeParams?.id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return Response.json({ ok: false, error: 'Missing trigger id' }, { status: 400 })
    }

    const result = await runLifecycleAction({
      payload: req.payload,
      options,
      id,
      action,
      version: typeof body.version === 'number' ? body.version : Number(body.version) || undefined,
      user: req.user as { id: string | number },
      cache,
    })
    return Response.json(result.body, { status: result.status })
  },
})
