import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTemplateRegistry,
} from '../types'
import { getDefaultTemplateRegistry } from './context'

export type SeedTemplatesResult = {
  created: string[]
  skipped: string[]
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
      }
    } else if (channel === 'inapp') {
      groups.inapp = {
        title: def.title || '',
        body: def.body || '',
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
 * Idempotently create `notification-templates` documents from the code registry.
 * Existing slugs are skipped (never overwritten).
 */
export const seedTemplatesFromRegistry = async ({
  payload,
  options,
  registry,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  registry?: NotificationTemplateRegistry
}): Promise<SeedTemplatesResult> => {
  const source = registry || {
    ...getDefaultTemplateRegistry(),
    ...options.templates.registry,
  }

  const created: string[] = []
  const skipped: string[] = []

  for (const [slug, set] of Object.entries(source)) {
    const existing = await payload.find({
      overrideAccess: true,
      collection: options.collections.templates,
      where: { slug: { equals: slug } },
      limit: 1,
    })

    if (existing.docs?.length) {
      skipped.push(slug)
      continue
    }

    const channelGroups = toChannelGroups(set)
    const channels = (channelGroups.channels as NotificationChannel[]) || []

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
        channels: channels.length ? channels : ['email', 'inapp'],
        email: channelGroups.email,
        sms: channelGroups.sms,
        whatsapp: channelGroups.whatsapp,
        inapp: channelGroups.inapp,
      },
    })

    created.push(slug)
  }

  return { created, skipped }
}
