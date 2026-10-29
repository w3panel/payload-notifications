import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTemplateResolution,
} from '../types'
import { getDefaultTemplateRegistry } from './context'
import { buildDefinitionFromTemplateDoc } from './fromDoc'
import { loadTemplateSnapshot, localeCandidates, normalizeLocale } from './versions'

const normalizeDefinition = (
  template: string | NotificationTemplateDefinition,
): NotificationTemplateDefinition => {
  if (typeof template === 'string') {
    return { body: template }
  }

  return template
}

type TemplateDoc = Record<string, unknown> & {
  id: string | number
  slug: string
  locale?: string | null
  version?: number
}

/**
 * Resolves from the notification-templates collection: active documents for
 * the slug, tried in locale order (`hi-IN` → `hi` → default → no locale); a
 * variant without content for the channel falls through to the next. Content
 * comes from the published snapshot (`version` pins one); documents published
 * before snapshots existed render from the document itself.
 */
const resolveFromDatabase = async ({
  payload,
  templateKey,
  channel,
  options,
  locale,
  version,
}: {
  payload?: Payload | null
  templateKey: string
  channel: NotificationChannel
  options: NormalizedNotificationsPluginOptions
  locale?: string | null
  version?: number
}): Promise<NotificationTemplateResolution | null> => {
  if (!payload || typeof payload.find !== 'function') return null

  let docs: TemplateDoc[]
  try {
    const result = await payload.find({
      overrideAccess: true,
      collection: options.collections.templates,
      where: {
        and: [{ slug: { equals: templateKey } }, { status: { equals: 'active' } }],
      },
      sort: '-version',
      limit: 50,
    })
    docs = (result.docs ?? []) as unknown as TemplateDoc[]
  } catch {
    // DB lookup failed (collection may not exist yet); fall back to code registry
    return null
  }

  // A pinned version belongs to one locale variant: look only there.
  const candidates =
    version !== undefined && typeof locale === 'string'
      ? [normalizeLocale(locale)]
      : localeCandidates(locale, options.templates.defaultLocale)
  for (const candidate of candidates) {
    const doc = docs.find((entry) => normalizeLocale(entry.locale) === candidate)
    if (!doc) continue

    const pinned = version ?? doc.version
    const snapshot =
      typeof pinned === 'number'
        ? await loadTemplateSnapshot(payload, options, doc.id, pinned).catch(() => undefined)
        : undefined
    const source = (snapshot?.content ?? doc) as Record<string, unknown>
    const definition = buildDefinitionFromTemplateDoc(source as never, channel)
    if (!definition.body && !definition.htmlBody) continue

    return {
      event: templateKey,
      channel,
      templateKey,
      definition,
      templateSlug: doc.slug,
      templateVersion: snapshot?.version ?? doc.version,
      templateLocale: candidate,
    }
  }
  return null
}

/**
 * Resolves a template from the in-memory code registry.
 */
const resolveFromRegistry = ({
  event,
  channel,
  templateKey,
  options,
  locale,
}: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
  locale?: string | null
}): NotificationTemplateResolution => {
  const registry = {
    ...getDefaultTemplateRegistry(),
    ...options.templates.registry,
  }

  const resolvedKey = templateKey || event
  for (const candidate of localeCandidates(locale, options.templates.defaultLocale)) {
    if (!candidate) break
    const localized = options.templates.localized[candidate]?.[resolvedKey]?.[channel]
    if (localized) {
      return {
        event,
        channel,
        templateKey: resolvedKey,
        definition: normalizeDefinition(localized),
        templateLocale: candidate,
      }
    }
  }
  const eventTemplates = registry[resolvedKey]

  if (!eventTemplates) {
    throw new Error(`Template set not found for key: ${resolvedKey}`)
  }

  const channelTemplate = eventTemplates[channel as NotificationChannel]

  if (!channelTemplate) {
    throw new Error(`Template for channel ${channel} not found in template set: ${resolvedKey}`)
  }

  return {
    event,
    channel,
    templateKey: resolvedKey,
    definition: normalizeDefinition(channelTemplate),
    templateLocale: '',
  }
}

/**
 * Resolves a template using DB-first lookup with code registry fallback.
 *
 * When a Payload instance is provided, queries the notification-templates
 * collection for an active template matching the slug. If no DB match is
 * found (or Payload is unavailable), falls back to the in-memory registry.
 */
export const resolveTemplate = async ({
  event,
  channel,
  templateKey,
  options,
  payload,
  locale,
  version,
}: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
  payload?: Payload | null
  /** Recipient locale; falls back to `templates.defaultLocale`, then templates without a locale. */
  locale?: string | null
  /** Pinned published version (from the delivery). */
  version?: number
}): Promise<NotificationTemplateResolution> => {
  const resolvedKey = templateKey || event

  // Try DB first if Payload is available
  const dbResult = await resolveFromDatabase({
    payload,
    templateKey: resolvedKey,
    channel,
    options,
    locale,
    version,
  })

  if (dbResult) return dbResult

  // Fall back to code registry
  return resolveFromRegistry({ event, channel, templateKey, options, locale })
}

/**
 * Synchronous resolver for backward compatibility.
 * Only checks the in-memory code registry — does not query the database.
 */
export const resolveTemplateSync = ({
  event,
  channel,
  templateKey,
  options,
}: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
}): NotificationTemplateResolution => {
  return resolveFromRegistry({ event, channel, templateKey, options })
}
