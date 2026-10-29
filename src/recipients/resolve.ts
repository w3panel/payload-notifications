import type { Payload, PayloadRequest, Where } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationDataContext,
  NotificationEvent,
  NotificationRecipientDefinition,
  RecipientDestinations,
  ResolvedRecipient,
} from '../types'
import { getPath, isObject, toRelationId } from '../data/paths'

const E164 = /^\+[1-9]\d{6,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const DEFAULT_RECIPIENTS: NotificationRecipientDefinition[] = [
  { type: 'eventUser', alias: 'user' },
]

/** Alias a recipient definition is addressed by from `deliveries[].recipient`. */
export const recipientAlias = (definition: NotificationRecipientDefinition, index: number) =>
  definition.alias || (definition.type === 'eventUser' ? 'user' : `recipient${index}`)

/**
 * Normalizes a phone number to E.164 (`+919876543210`). Numbers without a
 * country code get `defaultCountryCode` (leading trunk `0` dropped). Returns
 * undefined when the result is not a plausible E.164 number.
 */
export const normalizePhone = (raw: unknown, defaultCountryCode?: string): string | undefined => {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  let value = String(raw)
    .trim()
    .replace(/[\s\-().]/g, '')
  if (!value) return undefined
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (!value.startsWith('+')) {
    if (!defaultCountryCode) return undefined
    value = `${defaultCountryCode}${value.replace(/^0+/, '')}`
  }
  return E164.test(value) ? value : undefined
}

export const normalizeEmail = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  return EMAIL.test(value) ? value : undefined
}

const firstString = (doc: Record<string, unknown>, fields: string[]): string | undefined => {
  for (const field of fields) {
    const value = getPath(doc, field)
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/** Masks a destination for display: `a***@example.com`, `+91******3210`. */
export const maskDestination = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  if (value.includes('@')) {
    const [local, domain] = value.split('@')
    return `${local.slice(0, 1)}***@${domain}`
  }
  if (value.length <= 6) return '***'
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`
}

type Pending = {
  alias: string
  userIds: Array<string | number>
  explicit: Array<{
    recipientId?: string
    name?: string
    email?: string
    phone?: string
    locale?: string
    timezone?: string
  }>
}

const idsFrom = (value: unknown): Array<string | number> => {
  const list = Array.isArray(value) ? value : [value]
  return list.map(toRelationId).filter((id): id is string | number => id !== undefined)
}

export type ResolveRecipientsArgs = {
  payload: Payload
  event: NotificationEvent
  context: NotificationDataContext
  definitions?: NotificationRecipientDefinition[]
  options: NormalizedNotificationsPluginOptions
  /** Label used in warnings, e.g. `trigger "order-paid"`. */
  owner?: string
  /** Job request handed to recipient resolvers. */
  req?: PayloadRequest
}

export type ResolveRecipientsResult = {
  recipients: ResolvedRecipient[]
  /** Non-fatal problems (missing users, invalid destinations, caps). */
  warnings: string[]
}

/**
 * Resolves recipient definitions into canonical recipients with destinations.
 * Users are loaded in one query (destination fields only); recipients found
 * through several definitions are merged; the total is capped at
 * `recipients.maxPerEvent`. Database errors are rethrown for retry.
 */
export const resolveRecipients = async ({
  payload,
  event,
  context,
  definitions = DEFAULT_RECIPIENTS,
  options,
  owner = 'recipients',
  req,
}: ResolveRecipientsArgs): Promise<ResolveRecipientsResult> => {
  const settings = options.recipients
  const warnings: string[] = []
  const pending: Pending[] = []

  for (const [index, definition] of definitions.entries()) {
    const alias = recipientAlias(definition, index)
    const entry: Pending = { alias, userIds: [], explicit: [] }
    pending.push(entry)

    switch (definition.type) {
      case 'eventUser':
        if (event.userId) entry.userIds.push(event.userId)
        else warnings.push(`${owner}: recipient "${alias}" has no event userId`)
        break

      case 'context':
      case 'relationship': {
        const ids = idsFrom(getPath(context, definition.path))
        if (!ids.length)
          warnings.push(`${owner}: recipient "${alias}" found nothing at "${definition.path}"`)
        entry.userIds.push(...ids)
        break
      }

      case 'static':
        entry.explicit.push(definition)
        break

      case 'role':
      case 'query': {
        let where: Where
        let limit: number
        if (definition.type === 'role') {
          where = { [settings.roleField]: { in: [definition.role] } }
          limit = definition.maxResults ?? 50
        } else {
          const query = options.recipientQueries[definition.name]
          if (!query) {
            warnings.push(`${owner}: recipient query "${definition.name}" is not registered`)
            break
          }
          where = typeof query.where === 'function' ? query.where(context) : query.where
          limit = query.maxResults ?? 50
        }
        // Role / query recipients stay inside the event's tenant.
        if (options.tenancy && event.tenant) {
          where = { and: [where, { [options.tenancy.userField]: { equals: event.tenant } }] }
        }
        const result = await payload.find({
          collection: options.userCollectionSlug as never,
          where,
          limit: Math.min(limit, settings.maxPerEvent),
          depth: 0,
          select: { id: true } as never,
          overrideAccess: true,
          pagination: false,
        })
        entry.userIds.push(...idsFrom(result.docs))
        break
      }

      case 'resolver': {
        const resolver = options.recipientResolvers[definition.name]
        if (!resolver) {
          warnings.push(`${owner}: recipient resolver "${definition.name}" is not registered`)
          break
        }
        let results: unknown[]
        try {
          results = await resolver.handler({
            payload,
            event,
            context,
            input: definition.input ?? {},
            req,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const warning = `${owner}: recipient resolver "${definition.name}" failed: ${message}`
          warnings.push(warning)
          payload.logger?.warn?.({ err: error, resolver: definition.name }, warning)
          break
        }
        for (const result of Array.isArray(results) ? results : []) {
          if (typeof result === 'string' || typeof result === 'number') {
            entry.userIds.push(result)
          } else if (isObject(result)) {
            const id = toRelationId(result.id ?? result.recipientId)
            if (id !== undefined) entry.userIds.push(id)
            else entry.explicit.push(result as Pending['explicit'][number])
          }
        }
        break
      }
    }
  }

  // Load every referenced user once, with only the fields destinations need.
  const userIds = [...new Set(pending.flatMap((entry) => entry.userIds.map(String)))]
  const users = new Map<string, Record<string, unknown>>()
  if (userIds.length) {
    const fields = settings.destinationFields
    const select: Record<string, true> = {}
    for (const field of [
      ...fields.email,
      ...fields.sms,
      ...fields.whatsapp,
      ...fields.name,
      ...fields.locale,
      ...fields.timezone,
    ]) {
      select[field.split('.')[0]] = true
    }
    const result = await payload.find({
      collection: options.userCollectionSlug as never,
      where: { id: { in: userIds } },
      limit: userIds.length,
      depth: 0,
      select: select as never,
      overrideAccess: true,
      pagination: false,
    })
    for (const doc of result.docs as Record<string, unknown>[]) users.set(String(doc.id), doc)
  }

  const byKey = new Map<string, ResolvedRecipient>()
  const byDestination = new Map<string, ResolvedRecipient>()

  const add = (recipient: ResolvedRecipient) => {
    const existing =
      byKey.get(recipient.key) ??
      (recipient.destinations.email &&
        byDestination.get(`email:${recipient.destinations.email}`)) ??
      (recipient.destinations.sms && byDestination.get(`phone:${recipient.destinations.sms}`))
    if (existing) {
      for (const alias of recipient.aliases) {
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias)
      }
      return
    }
    byKey.set(recipient.key, recipient)
    if (recipient.destinations.email)
      byDestination.set(`email:${recipient.destinations.email}`, recipient)
    if (recipient.destinations.sms)
      byDestination.set(`phone:${recipient.destinations.sms}`, recipient)
  }

  const fields = settings.destinationFields
  for (const entry of pending) {
    for (const id of entry.userIds) {
      const user = users.get(String(id))
      if (!user) {
        warnings.push(`${owner}: recipient "${entry.alias}" user "${id}" was not found`)
        continue
      }
      const destinations: RecipientDestinations = {
        email: normalizeEmail(firstString(user, fields.email)),
        sms: normalizePhone(firstString(user, fields.sms), settings.defaultCountryCode),
        whatsapp: normalizePhone(firstString(user, fields.whatsapp), settings.defaultCountryCode),
        inapp: String(user.id),
      }
      add({
        key: `user:${user.id}`,
        aliases: [entry.alias],
        recipientId: String(user.id),
        name: firstString(user, fields.name),
        locale: firstString(user, fields.locale),
        timezone: firstString(user, fields.timezone),
        destinations,
      })
    }

    for (const explicit of entry.explicit) {
      const email = normalizeEmail(explicit.email)
      const phone = normalizePhone(explicit.phone, settings.defaultCountryCode)
      if (!email && !phone) {
        warnings.push(`${owner}: recipient "${entry.alias}" has no valid email or phone`)
        continue
      }
      add({
        key: email ? `email:${email}` : `phone:${phone}`,
        aliases: [entry.alias],
        recipientId: explicit.recipientId,
        name: explicit.name,
        locale: explicit.locale,
        timezone: explicit.timezone,
        destinations: { email, sms: phone, whatsapp: phone },
      })
    }
  }

  let recipients = [...byKey.values()]
  if (recipients.length > settings.maxPerEvent) {
    warnings.push(
      `${owner}: ${recipients.length} recipients exceed recipients.maxPerEvent (${settings.maxPerEvent}); extra recipients were dropped`,
    )
    recipients = recipients.slice(0, settings.maxPerEvent)
  }

  return { recipients, warnings }
}
