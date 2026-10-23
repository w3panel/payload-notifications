import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTemplateRecord,
  NotificationTemplateResolution,
} from '../types'
import { getDefaultTemplateRegistry } from './context'

const normalizeDefinition = (
  template: string | NotificationTemplateDefinition,
): NotificationTemplateDefinition => {
  if (typeof template === 'string') {
    return { body: template }
  }

  return template
}

/**
 * Attempts to resolve a template from the notification-templates collection.
 * Returns null if no match is found or if payload is not available.
 */
const resolveFromDatabase = async ({
  payload,
  templateKey,
  channel,
  options,
}: {
  payload?: Payload | null
  templateKey: string
  channel: NotificationChannel
  options: NormalizedNotificationsPluginOptions
}): Promise<NotificationTemplateResolution | null> => {
  if (!payload || typeof payload.find !== 'function') return null

  try {
    const result = await payload.find({
      overrideAccess: true,
      collection: options.collections.templates,
      where: {
        and: [{ slug: { equals: templateKey } }, { status: { equals: 'active' } }],
      },
      sort: '-version',
      limit: 1,
    })

    if (!result.docs?.length) return null

    const doc = result.docs[0] as unknown as NotificationTemplateRecord
    const channelContent = doc[channel as keyof NotificationTemplateRecord]

    if (!channelContent || typeof channelContent !== 'object') return null

    const definition: NotificationTemplateDefinition = {
      body:
        (channelContent as Record<string, string>).body ||
        (channelContent as Record<string, string>).htmlBody ||
        (channelContent as Record<string, string>).textBody ||
        '',
    }

    if (channel === 'email') {
      const email = channelContent as Record<string, string>
      if (email.subject) definition.subject = email.subject
    }

    if (channel === 'inapp') {
      const inapp = channelContent as Record<string, string>
      if (inapp.title) definition.title = inapp.title
    }

    return {
      event: templateKey,
      channel,
      templateKey,
      definition,
      templateSlug: doc.slug,
      templateVersion: doc.version,
    }
  } catch {
    // DB lookup failed (collection may not exist yet); fall back to code registry
    return null
  }
}

/**
 * Resolves a template from the in-memory code registry.
 */
const resolveFromRegistry = ({
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
  const registry = {
    ...getDefaultTemplateRegistry(),
    ...options.templates.registry,
  }

  const resolvedKey = templateKey || event
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
}: {
  event: string
  channel: NotificationChannel
  templateKey?: string
  options: NormalizedNotificationsPluginOptions
  payload?: Payload | null
}): Promise<NotificationTemplateResolution> => {
  const resolvedKey = templateKey || event

  // Try DB first if Payload is available
  const dbResult = await resolveFromDatabase({
    payload,
    templateKey: resolvedKey,
    channel,
    options,
  })

  if (dbResult) return dbResult

  // Fall back to code registry
  return resolveFromRegistry({ event, channel, templateKey, options })
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
