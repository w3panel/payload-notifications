import type { NotificationsPluginOptions, NormalizedNotificationsPluginOptions } from '../types'
import { normalizeComputedRegistry, normalizeResolverRegistry } from '../data/resolvers'
import { createSensitiveFieldMatcher, isSensitivePath } from '../data/sensitive'
import { validateDataSources } from '../data/sources'
import {
  normalizeRecipientQueries,
  normalizeRecipientResolvers,
  normalizeRecipientsOptions,
} from '../recipients/options'
import { normalizeCollectionEvents } from '../events/collectionEvents'
import { DEFAULT_MAX_EVENT_DEPTH } from '../events/depth'
import { isValidTimeZone, parseClock } from '../deliveries/schedule'
import { compileCodeTriggers } from '../triggers/compile'
import { validateTrigger } from '../triggers/validate'
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

const normalizeMaxEventDepth = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_MAX_EVENT_DEPTH
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error('payload-notifications: maxEventDepth must be an integer between 1 and 10')
  }
  return value
}

const normalizeTenancy = (
  tenancy: NonNullable<NotificationsPluginOptions['tenancy']>,
): NonNullable<NormalizedNotificationsPluginOptions['tenancy']> => {
  if (typeof tenancy.field !== 'string' || !tenancy.field) {
    throw new Error('payload-notifications: tenancy.field is required')
  }
  return { field: tenancy.field, userField: tenancy.userField || tenancy.field }
}

const normalizeQuietHours = (
  quietHours: NonNullable<NotificationsPluginOptions['quietHours']>,
): NonNullable<NormalizedNotificationsPluginOptions['quietHours']> => {
  if (parseClock(quietHours.start) === undefined || parseClock(quietHours.end) === undefined) {
    throw new Error('payload-notifications: quietHours.start and end must be HH:MM (24h)')
  }
  const timezone = quietHours.timezone || 'UTC'
  if (!isValidTimeZone(timezone)) {
    throw new Error(
      `payload-notifications: quietHours.timezone "${timezone}" is not a valid IANA zone`,
    )
  }
  return {
    start: quietHours.start,
    end: quietHours.end,
    timezone,
    classifications: quietHours.classifications ?? ['marketing'],
  }
}

const normalizeConditionRegistry = (
  conditions: NotificationsPluginOptions['conditions'],
): NormalizedNotificationsPluginOptions['conditions'] => {
  const normalized: NormalizedNotificationsPluginOptions['conditions'] = {}
  for (const [name, entry] of Object.entries(conditions ?? {})) {
    const definition = typeof entry === 'function' ? { handler: entry } : entry
    if (!definition || typeof definition.handler !== 'function') {
      throw new Error(
        `payload-notifications: conditions["${name}"] must be a function or { handler }`,
      )
    }
    normalized[name] = { ...definition }
  }
  return normalized
}

const normalizeDataOptions = (
  data: NotificationsPluginOptions['data'],
): NormalizedNotificationsPluginOptions['data'] => {
  const sensitiveFields = data?.sensitiveFields ?? []
  if (!Array.isArray(sensitiveFields) || sensitiveFields.some((name) => typeof name !== 'string')) {
    throw new Error('payload-notifications: data.sensitiveFields must be an array of field names')
  }
  const isSensitive = createSensitiveFieldMatcher(sensitiveFields)

  const collections: NormalizedNotificationsPluginOptions['data']['collections'] = {}

  for (const [slug, entry] of Object.entries(data?.collections ?? {})) {
    if (
      !entry ||
      !Array.isArray(entry.fields) ||
      entry.fields.some((field) => typeof field !== 'string' || !field)
    ) {
      throw new Error(
        `payload-notifications: data.collections["${slug}"].fields must be an array of field names`,
      )
    }
    for (const field of entry.fields) {
      if (isSensitivePath(field, isSensitive)) {
        throw new Error(
          `payload-notifications: data.collections["${slug}"] field "${field}" is sensitive and cannot be exposed to notifications`,
        )
      }
    }
    collections[slug] = { ...entry, fields: [...new Set(entry.fields)] }
  }

  const redact = data?.redact ?? []
  if (!Array.isArray(redact) || redact.some((path) => typeof path !== 'string')) {
    throw new Error('payload-notifications: data.redact must be an array of dot paths')
  }

  return { collections, redact: [...redact], sensitiveFields: [...sensitiveFields] }
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

  const deliveriesSlug = options.collections?.deliveries || 'notification-deliveries'
  const eventsSlug = options.collections?.events || 'notification-events'

  const allSlugs = [notificationsSlug, logsSlug, templatesSlug, deliveriesSlug, eventsSlug]
  if (new Set(allSlugs).size !== allSlugs.length) {
    throw new Error(
      'payload-notifications: notifications, logs, templates, deliveries, and events collections must use different slugs',
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

  const data = normalizeDataOptions(options.data)
  const dataResolvers = normalizeResolverRegistry(options.dataResolvers)
  const computed = normalizeComputedRegistry(options.computed)
  const rules = options.rules || []

  const isSensitive = createSensitiveFieldMatcher(data.sensitiveFields)
  const ruleErrors = rules.flatMap((rule, index) =>
    rule.data
      ? validateDataSources(rule.data.sources, {
          allowlist: data.collections,
          resolvers: Object.keys(dataResolvers),
          computed: Object.keys(computed),
          isSensitive,
          owner: `rules[${index}] ("${rule.event}")`,
        })
      : [],
  )
  if (ruleErrors.length) {
    throw new Error(
      `payload-notifications: invalid rule data sources\n  - ${ruleErrors.join('\n  - ')}`,
    )
  }

  const templates: NormalizedNotificationsPluginOptions['templates'] = {
    email: options.templates?.email,
    whatsapp: options.templates?.whatsapp,
    sms: options.templates?.sms,
    seedOnInit: options.templates?.seedOnInit === true,
    registry: {
      ...getDefaultTemplateRegistry(),
      ...options.templates?.registry,
    },
  }

  const triggers = compileCodeTriggers(rules, options.triggers)
  const recipients = normalizeRecipientsOptions(options.recipients)
  const recipientResolvers = normalizeRecipientResolvers(options.recipientResolvers)
  const recipientQueries = normalizeRecipientQueries(options.recipientQueries)

  const normalized: NormalizedNotificationsPluginOptions = {
    enabled: options.enabled ?? true,
    channels,
    userCollectionSlug: options.userCollectionSlug || 'users',
    collections: {
      notifications: notificationsSlug,
      logs: logsSlug,
      templates: templatesSlug,
      deliveries: deliveriesSlug,
      events: eventsSlug,
    },
    jobs: {
      queue: options.jobs?.queue?.trim() || NOTIFICATIONS_JOB_QUEUE,
    },
    templates,
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
    rules,
    events: normalizeEventRegistry(options.events),
    eventsStrict: options.eventsStrict === true,
    data,
    dataResolvers,
    computed,
    triggers,
    recipients,
    recipientResolvers,
    recipientQueries,
    conditions: normalizeConditionRegistry(options.conditions),
    collectionEvents: normalizeCollectionEvents(options.collectionEvents),
    maxEventDepth: normalizeMaxEventDepth(options.maxEventDepth),
    eventsInbox: options.eventsInbox === true,
    ...(options.tenancy ? { tenancy: normalizeTenancy(options.tenancy) } : {}),
    ...(options.quietHours ? { quietHours: normalizeQuietHours(options.quietHours) } : {}),
  }

  // Compiled rules keep their legacy behaviour (disabled channels are skipped silently).
  const triggerErrors = triggers.slice(rules.length).flatMap((trigger) => [
    ...(trigger.data
      ? validateDataSources(trigger.data.sources, {
          allowlist: data.collections,
          resolvers: Object.keys(dataResolvers),
          computed: Object.keys(computed),
          isSensitive,
          owner: `trigger "${trigger.slug}"`,
        })
      : []),
    ...validateTrigger(trigger, normalized).errors,
  ])
  if (triggerErrors.length) {
    throw new Error(`payload-notifications: invalid triggers\n  - ${triggerErrors.join('\n  - ')}`)
  }

  return normalized
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
