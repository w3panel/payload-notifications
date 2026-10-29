import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTemplateRegistry,
} from '../types'
import { getDefaultTemplateRegistry } from './context'
import { publishTemplate } from './lifecycle'
import { contentOf } from './versions'

export type SeedTemplatesResult = {
  created: string[]
  skipped: string[]
  /** Seeded documents nobody edited, refreshed to the current registry content (`updateUnedited`). */
  updated: string[]
}

/**
 * Drops empty values (null, '', [], {}) recursively so a document read back from
 * the database (where unset fields come back null or []) hashes like its seed.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = value.map(canonical).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, child]) => [key, canonical(child)] as const)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value === null || value === '' ? undefined : value
}

/** Stable FNV-1a hash of a template's content, to detect edits since seeding. */
export const contentHash = (doc: Record<string, unknown>): string => {
  const text = JSON.stringify(canonical(contentOf(doc)) ?? {})
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const CHANNELS: NotificationChannel[] = ['email', 'sms', 'whatsapp', 'inapp']

const toChannelGroups = (set: NotificationTemplateRegistry[string]): Record<string, unknown> => {
  const groups: Record<string, unknown> = {}
  const channels: NotificationChannel[] = []

  for (const channel of CHANNELS) {
    const entry = set?.[channel]
    if (!entry) continue
    channels.push(channel)

    if (typeof entry === 'string') {
      if (channel === 'email') {
        groups.email = { subject: `Notification: ${channel}`, textBody: entry, htmlBody: '' }
      } else if (channel === 'inapp') {
        groups.inapp = { title: 'Notification', body: entry }
      } else if (channel === 'sms') {
        groups.sms = { body: entry }
      } else if (channel === 'whatsapp') {
        groups.whatsapp = { body: entry }
      }
      continue
    }

    const def = entry as NotificationTemplateDefinition
    if (channel === 'email') {
      groups.email = {
        subject: def.subject || '',
        textBody: def.textBody || def.body || '',
        htmlBody: def.htmlBody || '',
        ...(def.preheader ? { preheader: def.preheader } : {}),
      }
    } else if (channel === 'inapp') {
      groups.inapp = {
        title: def.title || '',
        body: def.body || '',
        ...(def.actionUrl ? { actionUrl: def.actionUrl } : {}),
        ...(def.icon ? { icon: def.icon } : {}),
        ...(def.priority ? { priority: def.priority } : {}),
      }
    } else if (channel === 'sms') {
      groups.sms = { body: def.body || '' }
    } else if (channel === 'whatsapp') {
      groups.whatsapp = { body: def.body || '' }
    }
  }

  return { channels, ...groups }
}

/**
 * Idempotently creates `notification-templates` documents (status active,
 * published as version 1) from the code registry. Existing slugs are skipped;
 * with `updateUnedited`, seeded documents nobody has edited since seeding are
 * republished with the current registry content. Admin edits are never overwritten.
 */
export const seedTemplatesFromRegistry = async ({
  payload,
  options,
  registry,
  updateUnedited = false,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  registry?: NotificationTemplateRegistry
  updateUnedited?: boolean
}): Promise<SeedTemplatesResult> => {
  const source = registry || {
    ...getDefaultTemplateRegistry(),
    ...options.templates.registry,
  }

  const result: SeedTemplatesResult = { created: [], skipped: [], updated: [] }

  for (const [slug, set] of Object.entries(source)) {
    const channelGroups = toChannelGroups(set)
    const channels = (channelGroups.channels as NotificationChannel[]) || []
    const content = {
      channels: channels.length ? channels : ['email', 'inapp'],
      email: channelGroups.email,
      sms: channelGroups.sms,
      whatsapp: channelGroups.whatsapp,
      inapp: channelGroups.inapp,
    }
    const seedHash = contentHash(content)

    const existing = await payload.find({
      overrideAccess: true,
      collection: options.collections.templates,
      where: { slug: { equals: slug } },
      limit: 20,
    })
    // Only the default (no-locale) variant is seeded.
    const doc = (existing.docs as Array<Record<string, unknown> & { id: string | number }>).find(
      (entry) => !entry.locale,
    )

    if (doc) {
      const unedited = doc.source === 'seed' && doc.seedHash === contentHash(doc)
      if (updateUnedited && unedited && doc.seedHash !== seedHash) {
        const published = await publishTemplate({ payload, options, id: doc.id, content })
        if (published.ok) {
          await payload.update({
            overrideAccess: true,
            collection: options.collections.templates,
            id: doc.id,
            data: { seedHash } as never,
            context: { payloadNotificationsPublishingTemplate: true },
          })
          result.updated.push(slug)
          continue
        }
      }
      result.skipped.push(slug)
      continue
    }

    await payload.create({
      overrideAccess: true,
      collection: options.collections.templates,
      data: {
        name: slug,
        slug,
        description: `Seeded from code registry (${slug})`,
        category: 'transactional',
        status: 'active',
        version: 1,
        source: 'seed',
        seedHash,
        ...content,
      } as never,
    })

    result.created.push(slug)
  }

  return result
}
