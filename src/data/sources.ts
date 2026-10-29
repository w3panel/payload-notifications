import type { CollectionConfig, Field } from 'payload'
import type { DataCollectionAllowlist, NotificationDataSource } from '../types'

export const RESERVED_ALIASES = new Set([
  'event',
  'payload',
  'userId',
  'trigger',
  'recipient',
  'doc',
  'previous',
])

/** Roots a lookup `from` path may start with besides source aliases. */
const BUILTIN_ROOTS = new Set(['event', 'doc', 'previous'])

export const MAX_SOURCE_DEPTH = 2
export const DEFAULT_MAX_ITEMS = 50
export const MAX_ITEMS_LIMIT = 100

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const ALWAYS_ALLOWED_FIELDS = new Set(['id'])

export type DataSourceValidationContext = {
  allowlist: DataCollectionAllowlist
  /** Registered resolver names; omit to skip the check. */
  resolvers?: Iterable<string>
  /** Registered computed function names; omit to skip the check. */
  computed?: Iterable<string>
  /** Label used in error messages, e.g. `trigger "order-paid"`. */
  owner?: string
}

const rootOf = (path: string): string => path.split('.')[0]

/** Aliases a source reads from (beyond built-in roots). */
export const sourceDependencies = (source: NotificationDataSource): string[] => {
  if (source.type !== 'collection') return []
  const root = rootOf(source.lookup.from)
  return BUILTIN_ROOTS.has(root) ? [] : [root]
}

/**
 * Returns sources in dependency order (a source comes after every alias it reads
 * from). Throws on unknown aliases or cycles.
 */
export const orderDataSources = (
  sources: NotificationDataSource[],
  owner = 'data sources',
): NotificationDataSource[] => {
  const byAlias = new Map(sources.map((source) => [source.alias, source]))
  const ordered: NotificationDataSource[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (source: NotificationDataSource, trail: string[]) => {
    const status = state.get(source.alias)
    if (status === 'done') return
    if (status === 'visiting') {
      throw new Error(
        `payload-notifications: ${owner}: circular data source dependency ${[...trail, source.alias].join(' → ')}`,
      )
    }
    state.set(source.alias, 'visiting')
    for (const dependency of sourceDependencies(source)) {
      const target = byAlias.get(dependency)
      if (!target) {
        throw new Error(
          `payload-notifications: ${owner}: source "${source.alias}" reads from unknown alias "${dependency}"`,
        )
      }
      visit(target, [...trail, source.alias])
    }
    state.set(source.alias, 'done')
    ordered.push(source)
  }

  for (const source of sources) visit(source, [])
  return ordered
}

/**
 * Validates data-source definitions against the developer allowlist and
 * registries. Returns human-readable errors (empty when valid).
 */
export const validateDataSources = (
  sources: unknown,
  context: DataSourceValidationContext,
): string[] => {
  const owner = context.owner || 'data sources'
  const errors: string[] = []
  const prefix = (alias?: string) => `${owner}${alias ? ` source "${alias}"` : ''}:`

  if (!Array.isArray(sources)) {
    return [`${owner}: data.sources must be an array`]
  }

  const resolvers = context.resolvers ? new Set(context.resolvers) : undefined
  const computed = context.computed ? new Set(context.computed) : undefined
  const aliases = new Set<string>()

  for (const raw of sources as Array<Partial<NotificationDataSource>>) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`${owner}: each data source must be an object`)
      continue
    }

    const alias = raw.alias
    if (typeof alias !== 'string' || !ALIAS_PATTERN.test(alias)) {
      errors.push(`${prefix()} alias "${String(alias)}" must be an identifier (e.g. order)`)
      continue
    }
    if (RESERVED_ALIASES.has(alias)) {
      errors.push(`${prefix(alias)} alias is reserved`)
    }
    if (aliases.has(alias)) {
      errors.push(`${prefix(alias)} duplicate alias`)
    }
    aliases.add(alias)

    switch (raw.type) {
      case 'event':
      case 'document':
        if (raw.fields !== undefined && !Array.isArray(raw.fields)) {
          errors.push(`${prefix(alias)} fields must be an array`)
        }
        break

      case 'collection': {
        const allowed = context.allowlist[raw.collection ?? '']
        if (!raw.collection || !allowed) {
          errors.push(
            `${prefix(alias)} collection "${String(raw.collection)}" is not allowlisted — add it to data.collections`,
          )
          break
        }
        if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
          errors.push(`${prefix(alias)} fields must list at least one field`)
        } else {
          const allowedFields = new Set(allowed.fields)
          for (const field of raw.fields) {
            if (!ALWAYS_ALLOWED_FIELDS.has(field) && !allowedFields.has(field)) {
              errors.push(
                `${prefix(alias)} field "${field}" is not allowlisted for collection "${raw.collection}"`,
              )
            }
          }
        }
        const lookup = raw.lookup
        if (
          !lookup ||
          (lookup.type !== 'id' && lookup.type !== 'relationship') ||
          typeof lookup.from !== 'string' ||
          !lookup.from.includes('.')
        ) {
          errors.push(
            `${prefix(alias)} lookup must be { type: 'id' | 'relationship', from: '<root>.<path>' }`,
          )
        }
        if (
          raw.depth !== undefined &&
          (!Number.isInteger(raw.depth) || raw.depth < 0 || raw.depth > MAX_SOURCE_DEPTH)
        ) {
          errors.push(`${prefix(alias)} depth must be an integer between 0 and ${MAX_SOURCE_DEPTH}`)
        }
        if (
          raw.maxItems !== undefined &&
          (!Number.isInteger(raw.maxItems) || raw.maxItems < 1 || raw.maxItems > MAX_ITEMS_LIMIT)
        ) {
          errors.push(
            `${prefix(alias)} maxItems must be an integer between 1 and ${MAX_ITEMS_LIMIT}`,
          )
        }
        break
      }

      case 'resolver':
        if (typeof raw.name !== 'string' || !raw.name) {
          errors.push(`${prefix(alias)} resolver name is required`)
        } else if (resolvers && !resolvers.has(raw.name)) {
          errors.push(`${prefix(alias)} resolver "${raw.name}" is not registered in dataResolvers`)
        }
        break

      case 'computed':
        if (typeof raw.name !== 'string' || !raw.name) {
          errors.push(`${prefix(alias)} computed name is required`)
        } else if (computed && !computed.has(raw.name)) {
          errors.push(`${prefix(alias)} computed "${raw.name}" is not registered in computed`)
        }
        break

      default:
        errors.push(
          `${prefix(alias)} unknown type "${String(raw.type)}" (expected event, document, collection, resolver or computed)`,
        )
    }
  }

  if (errors.length) return errors

  const typed = sources as NotificationDataSource[]
  const byAlias = new Map(typed.map((source) => [source.alias, source]))

  // Relationship lookups must read a field the source alias actually loads.
  for (const source of typed) {
    if (source.type !== 'collection') continue
    const [root, ...rest] = source.lookup.from.split('.')
    const target = byAlias.get(root)
    if (target?.type === 'collection' && rest.length) {
      const field = rest[0]
      if (field !== 'id' && !target.fields.includes(field)) {
        errors.push(
          `${prefix(source.alias)} lookup reads "${source.lookup.from}" but source "${root}" does not load field "${field}"`,
        )
      }
    }
  }

  try {
    orderDataSources(typed, owner)
  } catch (error) {
    errors.push(
      (error instanceof Error ? error.message : String(error)).replace(
        'payload-notifications: ',
        '',
      ),
    )
  }

  return errors
}

/** Throws a single aggregated error when sources are invalid. */
export const assertValidDataSources = (
  sources: unknown,
  context: DataSourceValidationContext,
): NotificationDataSource[] => {
  const errors = validateDataSources(sources, context)
  if (errors.length) {
    throw new Error(`payload-notifications: invalid data sources\n  - ${errors.join('\n  - ')}`)
  }
  return sources as NotificationDataSource[]
}

/** Field paths a collection config exposes (named fields; groups as `group.child`). */
export const collectCollectionFieldPaths = (fields: Field[], prefix = ''): Set<string> => {
  const paths = new Set<string>()
  const add = (path: string) => paths.add(path)

  const walk = (list: Field[], base: string) => {
    for (const field of list) {
      const named = 'name' in field && typeof field.name === 'string' ? field.name : undefined
      if (field.type === 'tabs') {
        for (const tab of field.tabs) {
          const tabName = 'name' in tab && typeof tab.name === 'string' ? tab.name : undefined
          if (tabName) {
            add(base + tabName)
            walk(tab.fields, `${base}${tabName}.`)
          } else {
            walk(tab.fields, base)
          }
        }
        continue
      }
      if (named) {
        add(base + named)
        if (field.type === 'group' && 'fields' in field) {
          walk(field.fields, `${base}${named}.`)
        }
      } else if ('fields' in field && Array.isArray(field.fields)) {
        walk(field.fields, base)
      }
    }
  }

  walk(fields, prefix)
  return paths
}

/**
 * Checks the allowlist against the Payload config: every collection exists and
 * every allowlisted field exists in it. Called once at config time.
 */
export const validateDataAllowlist = (
  collections: CollectionConfig[],
  allowlist: DataCollectionAllowlist,
): string[] => {
  const errors: string[] = []
  const bySlug = new Map(collections.map((collection) => [collection.slug, collection]))

  for (const [slug, entry] of Object.entries(allowlist)) {
    const collection = bySlug.get(slug)
    if (!collection) {
      errors.push(`data.collections: collection "${slug}" does not exist in the Payload config`)
      continue
    }
    const available = collectCollectionFieldPaths(collection.fields)
    available.add('id')
    if (collection.timestamps !== false) {
      available.add('createdAt')
      available.add('updatedAt')
    }
    if (collection.auth) available.add('email')
    for (const field of entry.fields) {
      if (!available.has(field)) {
        errors.push(`data.collections: field "${field}" does not exist on collection "${slug}"`)
      }
    }
  }

  return errors
}
