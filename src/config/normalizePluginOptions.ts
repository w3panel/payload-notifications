import type { NotificationsPluginOptions, NormalizedNotificationsPluginOptions } from '../types'
import { isValidEventName } from '../events/names'
import { NOTIFICATIONS_JOB_QUEUE } from '../jobs/constants'
import { getDefaultTemplateRegistry } from '../templates/context'

/**
 * Safe defaults: only channels that work without external provider config.
 * Email uses Payload's built-in adapter; inapp uses the notifications collection.
 * Users must explicitly opt in to sms/whatsapp (which require provider credentials).
 *
 * BREAKING CHANGE from 0.1.x: default channels changed from
 * ['email', 'whatsapp', 'sms', 'inapp'] to ['email', 'inapp'].
 */
const DEFAULT_CHANNELS: NormalizedNotificationsPluginOptions['channels'] = ['email', 'inapp']

const VALID_CHANNELS = new Set(['email', 'whatsapp', 'sms', 'inapp', 'push'])

const VALID_CLASSIFICATIONS = new Set(['transactional', 'marketing'])

const normalizeEventRegistry = (
  events: NotificationsPluginOptions['events'],
): NormalizedNotificationsPluginOptions['events'] => {
  if (events === undefined) return {}
  if (typeof events !== 'object' || events === null || Array.isArray(events)) {
    throw new Error('payload-notifications: events must be an object keyed by event name')
  }

  for (const [name, definition] of Object.entries(events)) {
    if (!isValidEventName(name)) {
      throw new Error(
        `payload-notifications: invalid event name "${name}" (use letters, numbers and single . _ : - separators, e.g. order.paid)`,
      )
    }
    if (typeof definition !== 'object' || definition === null) {
      throw new Error(`payload-notifications: events["${name}"] must be an object`)
    }
    if (
      definition.classification !== undefined &&
      !VALID_CLASSIFICATIONS.has(definition.classification)
    ) {
      throw new Error(
        `payload-notifications: events["${name}"].classification must be "transactional" or "marketing"`,
      )
    }
    const schema = definition.schema as unknown
    if (
      schema !== undefined &&
      typeof schema !== 'function' &&
      !(typeof schema === 'object' && schema !== null && '~standard' in schema)
    ) {
      throw new Error(
        `payload-notifications: events["${name}"].schema must be a Standard Schema (Zod, Valibot, …) or a validator function`,
      )
    }
  }

  return { ...events }
}

export const normalizePluginOptions = (
  options: NotificationsPluginOptions = {},
): NormalizedNotificationsPluginOptions => {
  const userProvidedChannels = options.channels !== undefined

  if (userProvidedChannels && options.channels?.length === 0) {
    throw new Error('payload-notifications: at least one channel must be enabled')
  }

  const channels =
    userProvidedChannels && options.channels?.length
      ? [...new Set(options.channels)]
      : DEFAULT_CHANNELS

  const notificationsSlug = options.collections?.notifications || 'notifications'
  const logsSlug = options.collections?.logs || 'notification-logs'
  const templatesSlug = options.collections?.templates || 'notification-templates'

  if (notificationsSlug === logsSlug) {
    throw new Error(
      'payload-notifications: notifications and logs collections must use different slugs',
    )
  }

  const allSlugs = [notificationsSlug, logsSlug, templatesSlug]
  if (new Set(allSlugs).size !== allSlugs.length) {
    throw new Error(
      'payload-notifications: notifications, logs, and templates collections must use different slugs',
    )
  }

  for (const ch of channels) {
    if (!VALID_CHANNELS.has(ch)) {
      throw new Error(`payload-notifications: unknown channel "${ch}"`)
    }
  }

  if (channels.includes('whatsapp') && !options.providers?.whatsapp?.provider) {
    throw new Error(
      'payload-notifications: providers.whatsapp.provider is required when whatsapp channel is enabled',
    )
  }

  if (channels.includes('sms') && !options.providers?.sms?.provider) {
    throw new Error(
      'payload-notifications: providers.sms.provider is required when sms channel is enabled',
    )
  }

  if (channels.includes('sms') && options.providers?.sms?.provider === 'twilio') {
    const smsConfig = options.providers.sms
    if (!smsConfig.accountSid || !smsConfig.authToken || !smsConfig.from) {
      throw new Error('payload-notifications: Twilio SMS requires accountSid, authToken, and from')
    }
  }

  if (channels.includes('whatsapp') && options.providers?.whatsapp?.provider === 'meta') {
    const metaConfig = options.providers.whatsapp
    if (!metaConfig.accessToken || !metaConfig.phoneNumberId) {
      throw new Error(
        'payload-notifications: Meta WhatsApp Cloud API requires accessToken and phoneNumberId',
      )
    }
  }

  if (channels.includes('whatsapp') && options.providers?.whatsapp?.provider === 'twilio') {
    const waConfig = options.providers.whatsapp
    if (!waConfig.accountSid || !waConfig.authToken || !waConfig.from) {
      throw new Error(
        'payload-notifications: Twilio WhatsApp requires accountSid, authToken, and from',
      )
    }
  }

  if (!channels.length) {
    throw new Error('payload-notifications: at least one channel must be enabled')
  }

  return {
    enabled: options.enabled ?? true,
    channels,
    userCollectionSlug: options.userCollectionSlug || 'users',
    collections: {
      notifications: notificationsSlug,
      logs: logsSlug,
      templates: templatesSlug,
    },
    jobs: {
      queue: options.jobs?.queue?.trim() || NOTIFICATIONS_JOB_QUEUE,
    },
    templates: {
      email: options.templates?.email,
      whatsapp: options.templates?.whatsapp,
      sms: options.templates?.sms,
      seedOnInit: options.templates?.seedOnInit === true,
      registry: {
        ...getDefaultTemplateRegistry(),
        ...options.templates?.registry,
      },
    },
    providers: {
      email: options.providers?.email,
      whatsapp: options.providers?.whatsapp,
      sms: options.providers?.sms,
    },
    preferences: {
      fields: {
        channels: options.preferences?.fields?.channels || 'notificationPreferences.channels',
        marketingConsent:
          options.preferences?.fields?.marketingConsent || 'notificationPreferences.marketing',
      },
    },
    policy: {
      canSend: options.policy?.canSend,
    },
    observability: {
      onDispatch: options.observability?.onDispatch,
    },
    rules: options.rules || [],
    events: normalizeEventRegistry(options.events),
    eventsStrict: options.eventsStrict === true,
  }
}

/**
 * Validates a normalized options object. Called automatically by
 * `notificationsPlugin()`. Exported for use when building options
 * programmatically outside the plugin entry point.
 */
export const validateNormalizedOptions = (
  options: NormalizedNotificationsPluginOptions,
): NormalizedNotificationsPluginOptions => {
  if (!options.channels.length) {
    throw new Error('payload-notifications: at least one channel must be enabled')
  }

  if (options.channels.includes('sms') && !options.providers.sms?.provider) {
    throw new Error(
      'payload-notifications: providers.sms.provider is required when sms channel is enabled',
    )
  }

  if (options.channels.includes('whatsapp') && !options.providers.whatsapp?.provider) {
    throw new Error(
      'payload-notifications: providers.whatsapp.provider is required when whatsapp channel is enabled',
    )
  }

  return options
}
