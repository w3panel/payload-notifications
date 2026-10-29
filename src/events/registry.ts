import type {
  NormalizedNotificationsPluginOptions,
  NotificationEvent,
  NotificationEventDefinition,
  NotificationEventPayload,
  NotificationEventSchema,
  RegisteredNotificationEvent,
  StandardSchemaV1Like,
} from '../types'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isStandardSchema = (schema: NotificationEventSchema): schema is StandardSchemaV1Like => {
  return isObject(schema) && isObject((schema as Record<string, unknown>)['~standard'])
}

const formatIssuePath = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string => {
  if (!path?.length) return ''
  return path
    .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
    .join('.')
}

/**
 * Validates an event payload against its registered schema and returns the
 * (possibly transformed) payload. Throws with the event name and failing path.
 */
export const validateEventPayload = async (
  eventName: string,
  definition: NotificationEventDefinition | undefined,
  payload: NotificationEventPayload,
): Promise<NotificationEventPayload> => {
  const schema = definition?.schema
  if (!schema) return payload

  if (isStandardSchema(schema)) {
    const result = await schema['~standard'].validate(payload)
    if (result.issues) {
      const details = result.issues
        .map((issue) => {
          const path = formatIssuePath(issue.path)
          return path ? `${path}: ${issue.message}` : issue.message
        })
        .join('; ')
      throw new Error(`payload-notifications: invalid payload for event "${eventName}": ${details}`)
    }
    if (!isObject(result.value)) {
      throw new Error(
        `payload-notifications: schema for event "${eventName}" must produce an object payload`,
      )
    }
    return result.value
  }

  try {
    const value = await schema(payload)
    if (!isObject(value)) {
      throw new Error('validator must return an object payload')
    }
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`payload-notifications: invalid payload for event "${eventName}": ${message}`)
  }
}

const generateEventId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `evt_${globalThis.crypto.randomUUID()}`
  }
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Applies registry rules to an already shape-checked event: strict-mode lookup,
 * default classification, payload validation, `eventId` and `occurredAt`.
 */
export const prepareNotificationEvent = async (
  event: NotificationEvent,
  options?: Pick<NormalizedNotificationsPluginOptions, 'events' | 'eventsStrict'>,
): Promise<NotificationEvent> => {
  const definition = options?.events[event.name]

  if (!definition && options?.eventsStrict) {
    throw new Error(
      `payload-notifications: event "${event.name}" is not registered (eventsStrict is enabled)`,
    )
  }

  const payload = definition
    ? await validateEventPayload(event.name, definition, event.payload ?? {})
    : event.payload

  return {
    ...event,
    eventId: event.eventId || generateEventId(),
    occurredAt: event.occurredAt || new Date().toISOString(),
    classification: event.classification ?? definition?.classification,
    payload,
  }
}

/** Dot paths of leaf values in a sample object; arrays contribute `path` and `path.0.*`. */
export const collectFieldPaths = (value: unknown, prefix = '', depth = 0): string[] => {
  if (depth > 5) return prefix ? [prefix] : []
  if (Array.isArray(value)) {
    const paths = prefix ? [prefix] : []
    if (value.length) paths.push(...collectFieldPaths(value[0], `${prefix}.0`, depth + 1))
    return paths
  }
  if (!isObject(value)) return prefix ? [prefix] : []

  const paths: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isObject(child) || Array.isArray(child)) {
      paths.push(...collectFieldPaths(child, path, depth + 1))
    } else {
      paths.push(path)
    }
  }
  return paths
}

export const listRegisteredEvents = (
  options: Pick<NormalizedNotificationsPluginOptions, 'events'>,
): RegisteredNotificationEvent[] => {
  return Object.entries(options.events)
    .map(([name, definition]) => ({
      name,
      label: definition.label || name,
      description: definition.description,
      classification: definition.classification,
      samplePayload: definition.samplePayload,
      fields: definition.samplePayload ? collectFieldPaths(definition.samplePayload) : [],
      docsUrl: definition.docsUrl,
      hasSchema: Boolean(definition.schema),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
