import type {
  NormalizedNotificationsPluginOptions,
  NotificationRecipientResolverDefinition,
  NotificationsPluginOptions,
} from '../types'

const DEFAULT_DESTINATION_FIELDS = {
  email: ['email'],
  sms: ['phone', 'phoneNumber'],
  whatsapp: ['whatsapp', 'phone', 'phoneNumber'],
  name: ['name', 'fullName', 'firstName'],
  locale: ['locale', 'language'],
  timezone: ['timezone', 'timeZone'],
}

export const DEFAULT_MAX_RECIPIENTS = 100

const toList = (value: string | string[] | undefined, fallback: string[]): string[] => {
  if (value === undefined) return fallback
  const list = Array.isArray(value) ? value : [value]
  if (!list.length || list.some((field) => typeof field !== 'string' || !field)) {
    throw new Error(
      'payload-notifications: recipients.destinationFields entries must be field names',
    )
  }
  return list
}

export const normalizeRecipientsOptions = (
  recipients: NotificationsPluginOptions['recipients'],
): NormalizedNotificationsPluginOptions['recipients'] => {
  const fields = recipients?.destinationFields ?? {}
  const maxPerEvent = recipients?.maxPerEvent ?? DEFAULT_MAX_RECIPIENTS
  if (!Number.isInteger(maxPerEvent) || maxPerEvent < 1 || maxPerEvent > 10_000) {
    throw new Error(
      'payload-notifications: recipients.maxPerEvent must be an integer between 1 and 10000',
    )
  }
  const countryCode = recipients?.defaultCountryCode
  if (countryCode !== undefined && !/^\+[1-9]\d{0,3}$/.test(countryCode)) {
    throw new Error('payload-notifications: recipients.defaultCountryCode must look like +91')
  }

  return {
    destinationFields: {
      email: toList(fields.email, DEFAULT_DESTINATION_FIELDS.email),
      sms: toList(fields.sms, DEFAULT_DESTINATION_FIELDS.sms),
      whatsapp: toList(fields.whatsapp, DEFAULT_DESTINATION_FIELDS.whatsapp),
      name: toList(fields.name, DEFAULT_DESTINATION_FIELDS.name),
      locale: toList(fields.locale, DEFAULT_DESTINATION_FIELDS.locale),
      timezone: toList(fields.timezone, DEFAULT_DESTINATION_FIELDS.timezone),
    },
    defaultCountryCode: countryCode,
    roleField: recipients?.roleField || 'roles',
    maxPerEvent,
  }
}

export const normalizeRecipientResolvers = (
  resolvers: NotificationsPluginOptions['recipientResolvers'],
): Record<string, NotificationRecipientResolverDefinition> => {
  const normalized: Record<string, NotificationRecipientResolverDefinition> = {}
  for (const [name, entry] of Object.entries(resolvers ?? {})) {
    const definition = typeof entry === 'function' ? { handler: entry } : entry
    if (!definition || typeof definition.handler !== 'function') {
      throw new Error(
        `payload-notifications: recipientResolvers["${name}"] must be a function or { handler }`,
      )
    }
    normalized[name] = { ...definition }
  }
  return normalized
}

export const normalizeRecipientQueries = (
  queries: NotificationsPluginOptions['recipientQueries'],
): NormalizedNotificationsPluginOptions['recipientQueries'] => {
  const normalized: NormalizedNotificationsPluginOptions['recipientQueries'] = {}
  for (const [name, entry] of Object.entries(queries ?? {})) {
    if (!entry || (typeof entry.where !== 'object' && typeof entry.where !== 'function')) {
      throw new Error(`payload-notifications: recipientQueries["${name}"].where is required`)
    }
    normalized[name] = { ...entry }
  }
  return normalized
}
