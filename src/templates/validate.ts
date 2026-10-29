import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { buildDefinitionFromTemplateDoc } from './fromDoc'
import { compile } from './engine'
import {
  availableVariables,
  checkTemplateVariables,
  definitionSources,
  TEMPLATE_CHANNELS,
} from './variables'

export type TemplateValidationReport = { errors: string[]; warnings: string[] }

/**
 * Publish-time checks for a template document: every channel's content must
 * compile; when the slug is a registered event, variables are compared with
 * what that event provides (unknown → warning, required but missing → error).
 */
export const validateTemplateDoc = async (
  _payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  doc: Record<string, unknown>,
): Promise<TemplateValidationReport> => {
  const errors: string[] = []
  const warnings: string[] = []
  const slug = String(doc.slug ?? '')
  const channels = (Array.isArray(doc.channels) ? doc.channels : TEMPLATE_CHANNELS) as string[]
  const sources: string[] = []

  for (const channel of TEMPLATE_CHANNELS.filter((entry) => channels.includes(entry))) {
    const definition = buildDefinitionFromTemplateDoc(doc as never, channel)
    for (const source of definitionSources(definition)) {
      try {
        compile(source)
        sources.push(source)
      } catch (error) {
        errors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  if (options.events[slug]) {
    const check = checkTemplateVariables(
      sources,
      availableVariables(options, { event: slug }),
      doc.variables as Array<{ name?: string; required?: boolean }>,
    )
    warnings.push(...check.unknown.map((path) => `"${path}" is not provided by event "${slug}"`))
    errors.push(
      ...check.missingRequired.map(
        (path) => `required variable "${path}" is not provided by event "${slug}"`,
      ),
    )
  }

  return { errors, warnings }
}

/**
 * `GET /api/notification-templates/variables?event=order.paid&trigger=slug` —
 * variables authors can use, for editor autocomplete.
 */
export const templateVariablesEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint => ({
  path: '/variables',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const options = getOptions()
    const url = new URL(req.url || 'http://localhost')
    const triggerSlug = url.searchParams.get('trigger')
    const trigger = triggerSlug
      ? options.triggers.find((entry) => entry.slug === triggerSlug)
      : undefined
    const available = availableVariables(options, {
      event: url.searchParams.get('event') ?? undefined,
      trigger,
    })
    return Response.json({ variables: available.paths })
  },
})
