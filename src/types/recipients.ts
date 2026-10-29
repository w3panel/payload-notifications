import type { Payload, Where } from 'payload'
import type { NotificationDataContext } from './data-sources'
import type { NotificationEvent } from './events'

type RecipientBase = {
  /**
   * Name deliveries use to target this recipient (`deliveries[].recipient`).
   * Defaults to `user` for `eventUser` and `recipient<N>` otherwise.
   */
  alias?: string
}

/** The user in `event.userId`. */
export type EventUserRecipient = RecipientBase & { type: 'eventUser' }

/**
 * A user ID, user document, relationship value or list of them at a context
 * path, e.g. `customer.id` or `order.accountManager`.
 */
export type ContextRecipient = RecipientBase & { type: 'context' | 'relationship'; path: string }

/** A fixed destination, e.g. an operations mailbox. */
export type StaticRecipient = RecipientBase & {
  type: 'static'
  name?: string
  email?: string
  phone?: string
  locale?: string
  timezone?: string
}

/** Users whose `recipients.roleField` contains `role`. */
export type RoleRecipient = RecipientBase & { type: 'role'; role: string; maxResults?: number }

/** A developer-registered `recipientResolvers` entry. */
export type ResolverRecipient = RecipientBase & {
  type: 'resolver'
  name: string
  input?: Record<string, unknown>
}

/** A developer-registered named `recipientQueries` entry. */
export type QueryRecipient = RecipientBase & { type: 'query'; name: string }

export type NotificationRecipientDefinition =
  | EventUserRecipient
  | ContextRecipient
  | StaticRecipient
  | RoleRecipient
  | ResolverRecipient
  | QueryRecipient

export type RecipientDestinations = {
  email?: string
  sms?: string
  whatsapp?: string
  /** User ID for in-app notifications. */
  inapp?: string
}

/** A recipient after resolution: one identity, its destinations and the aliases that found it. */
export type ResolvedRecipient = {
  /** Stable dedupe key: `user:<id>` or `email:<address>` / `phone:<e164>`. */
  key: string
  aliases: string[]
  recipientId?: string
  name?: string
  locale?: string
  timezone?: string
  destinations: RecipientDestinations
}

/** What a recipient resolver may return: user IDs, user documents or explicit recipients. */
export type RecipientResolverResult =
  | string
  | number
  | Record<string, unknown>
  | {
      recipientId?: string
      name?: string
      email?: string
      phone?: string
      locale?: string
      timezone?: string
    }

export type NotificationRecipientResolverDefinition = {
  handler: (args: {
    payload: Payload
    event: NotificationEvent
    context: NotificationDataContext
    input: Record<string, unknown>
  }) => RecipientResolverResult[] | Promise<RecipientResolverResult[]>
  label?: string
  description?: string
}

export type NotificationRecipientQueryDefinition = {
  /** Where clause on the user collection, or a function of the resolved context. */
  where: Where | ((context: NotificationDataContext) => Where)
  label?: string
  description?: string
  /** Default 50, max `recipients.maxPerEvent`. */
  maxResults?: number
}

export type NotificationRecipientsOptions = {
  /** User fields read for each destination. */
  destinationFields?: {
    email?: string | string[]
    sms?: string | string[]
    whatsapp?: string | string[]
    name?: string | string[]
    locale?: string | string[]
    timezone?: string | string[]
  }
  /** Prefixed to phone numbers without a `+` country code, e.g. `+91`. */
  defaultCountryCode?: string
  /** User field holding roles for `role` recipients. Default `roles`. */
  roleField?: string
  /** Cap on recipients per trigger per event. Default 100. */
  maxPerEvent?: number
}
