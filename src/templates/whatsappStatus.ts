import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'

const META_GRAPH = 'https://graph.facebook.com/v25.0'

type MetaTemplate = { name: string; status: string; language: string }

/**
 * Fetches a WhatsApp template's approval status from Meta (needs
 * `providers.whatsapp.businessAccountId` and `accessToken`).
 */
export const fetchWhatsAppTemplateStatus = async (
  options: NormalizedNotificationsPluginOptions,
  name: string,
  language: string,
): Promise<string> => {
  const config = options.providers.whatsapp
  if (config?.provider !== 'meta' || !config.businessAccountId || !config.accessToken) {
    throw new Error(
      'WhatsApp template sync needs a Meta provider with businessAccountId and accessToken',
    )
  }
  const url = `${META_GRAPH}/${config.businessAccountId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` } })
  const body = (await response.json()) as { data?: MetaTemplate[]; error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message || `Meta API returned ${response.status}`)
  const normalize = (code: string) => code.replace('-', '_').toLowerCase()
  const match =
    body.data?.find(
      (entry) => entry.name === name && normalize(entry.language) === normalize(language),
    ) ?? body.data?.find((entry) => entry.name === name)
  return match?.status ?? 'NOT_FOUND'
}

/** Syncs and stores the approval status on a template document. */
export const syncWhatsAppTemplateStatus = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  id: string | number,
): Promise<{ status: string } | { error: string; httpStatus: number }> => {
  const doc = (await payload.findByID({
    collection: options.collections.templates as never,
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as { whatsapp?: { hsmTemplateId?: string; hsmLanguage?: string } } | null
  if (!doc) return { error: 'Template not found', httpStatus: 404 }
  const name = doc.whatsapp?.hsmTemplateId
  if (!name) return { error: 'Template has no WhatsApp template name', httpStatus: 400 }
  let status: string
  try {
    status = await fetchWhatsAppTemplateStatus(options, name, doc.whatsapp?.hsmLanguage || 'en')
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), httpStatus: 502 }
  }
  await payload.update({
    collection: options.collections.templates as never,
    id,
    overrideAccess: true,
    data: {
      whatsappTemplateStatus: status,
      whatsappTemplateCheckedAt: new Date().toISOString(),
    } as never,
  })
  return { status }
}

/** `POST /api/notification-templates/:id/whatsapp-status` (access.publishTemplates). */
export const whatsappStatusEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint => ({
  path: '/:id/whatsapp-status',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    const options = getOptions()
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await options.access.publishTemplates({ req }))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const id = req.routeParams?.id as string | number | undefined
    if (id === undefined) return Response.json({ error: 'Missing template id' }, { status: 400 })
    const result = await syncWhatsAppTemplateStatus(req.payload, options, id)
    return 'error' in result
      ? Response.json({ error: result.error }, { status: result.httpStatus })
      : Response.json({ ok: true, status: result.status })
  },
})
