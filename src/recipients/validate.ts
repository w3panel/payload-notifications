import type {
  NormalizedNotificationsPluginOptions,
  NotificationRecipientDefinition,
} from '../types'
import { normalizeEmail, normalizePhone, recipientAlias } from './resolve'

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const TYPES = new Set([
  'eventUser',
  'context',
  'relationship',
  'static',
  'role',
  'resolver',
  'query',
])

/** Validates recipient definitions against registered resolvers/queries. Returns errors. */
export const validateRecipientDefinitions = (
  definitions: unknown,
  options: Pick<
    NormalizedNotificationsPluginOptions,
    'recipientResolvers' | 'recipientQueries' | 'recipients'
  >,
  owner = 'recipients',
): string[] => {
  if (definitions === undefined) return []
  if (!Array.isArray(definitions)) return [`${owner}: recipients must be an array`]

  const errors: string[] = []
  const aliases = new Set<string>()

  definitions.forEach((raw: Partial<NotificationRecipientDefinition>, index) => {
    if (!raw || typeof raw !== 'object' || !TYPES.has(String(raw.type))) {
      errors.push(`${owner}: recipients[${index}] has unknown type "${String(raw?.type)}"`)
      return
    }
    const definition = raw as NotificationRecipientDefinition
    const alias = recipientAlias(definition, index)
    const label = `${owner} recipient "${alias}"`

    if (!ALIAS_PATTERN.test(alias) || alias === 'all') {
      errors.push(`${label}: alias must be an identifier other than "all"`)
    }
    if (aliases.has(alias)) errors.push(`${label}: duplicate alias`)
    aliases.add(alias)

    switch (definition.type) {
      case 'context':
      case 'relationship':
        if (typeof definition.path !== 'string' || !definition.path) {
          errors.push(`${label}: path is required`)
        }
        break
      case 'static': {
        const email = definition.email !== undefined ? normalizeEmail(definition.email) : undefined
        const phone =
          definition.phone !== undefined
            ? normalizePhone(definition.phone, options.recipients.defaultCountryCode)
            : undefined
        if (definition.email !== undefined && !email) errors.push(`${label}: invalid email`)
        if (definition.phone !== undefined && !phone) {
          errors.push(`${label}: phone must be E.164 (e.g. +919876543210)`)
        }
        if (definition.email === undefined && definition.phone === undefined) {
          errors.push(`${label}: email or phone is required`)
        }
        break
      }
      case 'role':
        if (typeof definition.role !== 'string' || !definition.role) {
          errors.push(`${label}: role is required`)
        }
        break
      case 'resolver':
        if (!options.recipientResolvers[definition.name]) {
          errors.push(`${label}: recipient resolver "${definition.name}" is not registered`)
        }
        break
      case 'query':
        if (!options.recipientQueries[definition.name]) {
          errors.push(`${label}: recipient query "${definition.name}" is not registered`)
        }
        break
    }
  })

  return errors
}
