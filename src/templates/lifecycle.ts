import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { TEMPLATE_CONTENT_FIELDS, loadTemplateSnapshot, snapshotTemplate } from './versions'

/** Set on `req.context` while publishing so the collection hooks leave versioning alone. */
const PUBLISHING_CONTEXT = { payloadNotificationsPublishingTemplate: true }

type TemplateDoc = Record<string, unknown> & {
  id: string | number
  version?: number
  status?: string
}

export type TemplatePublishResult =
  | { ok: true; version: number; doc: Record<string, unknown> }
  | { ok: false; status: number; error: string; details?: unknown }

/**
 * Publishes a template's current content as version N+1 (immutable snapshot)
 * and makes it active. Optional `validate` can block publishing.
 */
export const publishTemplate = async ({
  payload,
  options,
  id,
  user,
  content,
  validate,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  id: string | number
  user?: { id: string | number } | null
  /** Content to publish instead of the document's (rollback). */
  content?: Record<string, unknown>
  validate?: (doc: Record<string, unknown>) => Promise<{ errors: string[] } | undefined>
}): Promise<TemplatePublishResult> => {
  const collection = options.collections.templates as never
  const doc = (await payload.findByID({
    collection,
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as TemplateDoc | null
  if (!doc) return { ok: false, status: 404, error: 'Template not found' }
  if (doc.status === 'archived')
    return { ok: false, status: 409, error: 'Archived templates cannot be published' }

  const candidate = { ...doc, ...content }
  const report = await validate?.(candidate)
  if (report?.errors.length) {
    return { ok: false, status: 422, error: 'Validation failed', details: report }
  }

  const version = (Number(doc.version) || 0) + 1
  const updated = (await payload.update({
    collection,
    id,
    overrideAccess: true,
    context: PUBLISHING_CONTEXT,
    data: {
      ...content,
      status: 'active',
      version,
      hasUnpublishedChanges: false,
    } as never,
  })) as TemplateDoc
  await snapshotTemplate({ payload, options, doc: updated, version, user })
  return { ok: true, version, doc: updated }
}

/** Copies version `version`'s content back and publishes it as a new version. */
export const rollbackTemplate = async ({
  payload,
  options,
  id,
  version,
  user,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  id: string | number
  version: number
  user?: { id: string | number } | null
}): Promise<TemplatePublishResult> => {
  const snapshot = await loadTemplateSnapshot(payload, options, id, version)
  if (!snapshot) return { ok: false, status: 404, error: `Version ${version} not found` }
  const content = Object.fromEntries(
    TEMPLATE_CONTENT_FIELDS.map((field) => [field, snapshot.content[field] ?? null]),
  )
  return publishTemplate({ payload, options, id, user, content })
}

/**
 * `POST /api/notification-templates/:id/publish` and
 * `POST /api/notification-templates/:id/rollback { version }` (access.publishTemplates).
 */
export const templateLifecycleEndpoints = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  validate?: (
    payload: Payload,
    options: NormalizedNotificationsPluginOptions,
    doc: Record<string, unknown>,
  ) => Promise<{ errors: string[] } | undefined>,
): Endpoint[] => {
  const guard = async (req: PayloadRequest) => {
    const options = getOptions()
    if (!req.user)
      return { options, denied: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
    if (!(await options.access.publishTemplates({ req }))) {
      return { options, denied: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    return { options }
  }
  const idOf = (req: PayloadRequest) => req.routeParams?.id as string | number | undefined
  const reply = (result: TemplatePublishResult) =>
    result.ok
      ? Response.json({ ok: true, version: result.version, doc: result.doc })
      : Response.json(
          { ok: false, error: result.error, details: result.details },
          { status: result.status },
        )

  return [
    {
      path: '/:id/publish',
      method: 'post',
      handler: async (req) => {
        const { options, denied } = await guard(req)
        if (denied) return denied
        const id = idOf(req)
        if (id === undefined)
          return Response.json({ error: 'Missing template id' }, { status: 400 })
        return reply(
          await publishTemplate({
            payload: req.payload,
            options,
            id,
            user: req.user as { id: string | number },
            validate: validate ? (doc) => validate(req.payload, options, doc) : undefined,
          }),
        )
      },
    },
    {
      path: '/:id/rollback',
      method: 'post',
      handler: async (req) => {
        const { options, denied } = await guard(req)
        if (denied) return denied
        const id = idOf(req)
        let body: Record<string, unknown> = {}
        try {
          body = ((await req.json?.()) as Record<string, unknown>) ?? {}
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const version = Number(body.version)
        if (id === undefined || !Number.isInteger(version) || version < 1) {
          return Response.json({ error: 'version is required' }, { status: 400 })
        }
        return reply(
          await rollbackTemplate({
            payload: req.payload,
            options,
            id,
            version,
            user: req.user as { id: string | number },
          }),
        )
      },
    },
  ]
}
