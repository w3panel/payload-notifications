import type { Payload } from 'payload'
import type {
  NotificationComputedDefinition,
  NotificationComputedRegistry,
  NotificationDataContext,
  NotificationDataResolverDefinition,
  NotificationDataResolverRegistry,
  NotificationEvent,
  RegisteredDataFunction,
} from '../types'
import { checkSchema, isSchemaLike } from './schema'

export const DEFAULT_RESOLVER_TIMEOUT_MS = 5000
export const MAX_RESOLVER_TIMEOUT_MS = 60_000

export type ResolverErrorKind = 'timeout' | 'invalid-input' | 'invalid-output' | 'error'

/** Failure of a registered resolver or computed function, tagged with its name. */
export class ResolverError extends Error {
  readonly resolver: string
  readonly kind: ResolverErrorKind

  constructor(resolver: string, kind: ResolverErrorKind, message: string, options?: ErrorOptions) {
    super(`payload-notifications: resolver "${resolver}" ${message}`, options)
    this.name = 'ResolverError'
    this.resolver = resolver
    this.kind = kind
  }
}

export const normalizeResolverRegistry = (
  registry: NotificationDataResolverRegistry | undefined,
): Record<string, NotificationDataResolverDefinition> => {
  const normalized: Record<string, NotificationDataResolverDefinition> = {}

  for (const [name, entry] of Object.entries(registry ?? {})) {
    const definition = typeof entry === 'function' ? { handler: entry } : entry
    if (!definition || typeof definition.handler !== 'function') {
      throw new Error(
        `payload-notifications: dataResolvers["${name}"] must be a function or { handler }`,
      )
    }
    const timeout = definition.timeoutMs
    if (
      timeout !== undefined &&
      (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_RESOLVER_TIMEOUT_MS)
    ) {
      throw new Error(
        `payload-notifications: dataResolvers["${name}"].timeoutMs must be an integer between 1 and ${MAX_RESOLVER_TIMEOUT_MS}`,
      )
    }
    for (const key of ['input', 'output'] as const) {
      if (definition[key] !== undefined && !isSchemaLike(definition[key])) {
        throw new Error(
          `payload-notifications: dataResolvers["${name}"].${key} must be a Standard Schema or validator function`,
        )
      }
    }
    normalized[name] = { ...definition }
  }

  return normalized
}

export const normalizeComputedRegistry = (
  registry: NotificationComputedRegistry | undefined,
): Record<string, NotificationComputedDefinition> => {
  const normalized: Record<string, NotificationComputedDefinition> = {}

  for (const [name, entry] of Object.entries(registry ?? {})) {
    const definition = typeof entry === 'function' ? { handler: entry } : entry
    if (!definition || typeof definition.handler !== 'function') {
      throw new Error(
        `payload-notifications: computed["${name}"] must be a function or { handler }`,
      )
    }
    normalized[name] = { ...definition }
  }

  return normalized
}

const withTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> => {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ timedOut: true })
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      run(controller.signal).then((value) => ({ timedOut: false as const, value })),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Calls a registered resolver with input validation, a timeout and output
 * validation. Throws `ResolverError` on any failure.
 */
export const runDataResolver = async ({
  name,
  definition,
  payload,
  event,
  context,
  input = {},
}: {
  name: string
  definition: NotificationDataResolverDefinition
  payload: Payload
  event: NotificationEvent
  context: NotificationDataContext
  input?: Record<string, unknown>
}): Promise<unknown> => {
  let resolvedInput: Record<string, unknown> = input
  if (definition.input) {
    const checked = await checkSchema(definition.input, input)
    if (!checked.ok)
      throw new ResolverError(name, 'invalid-input', `rejected input: ${checked.message}`)
    resolvedInput = (checked.value ?? {}) as Record<string, unknown>
  }

  const timeoutMs = definition.timeoutMs ?? DEFAULT_RESOLVER_TIMEOUT_MS
  let outcome: Awaited<ReturnType<typeof withTimeout<unknown>>>
  try {
    outcome = await withTimeout(
      async (signal) =>
        definition.handler({ payload, event, context, input: resolvedInput, signal }),
      timeoutMs,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ResolverError(name, 'error', `failed: ${message}`, { cause: error })
  }

  if (outcome.timedOut) {
    throw new ResolverError(name, 'timeout', `timed out after ${timeoutMs} ms`)
  }

  if (!definition.output) return outcome.value

  const checked = await checkSchema(definition.output, outcome.value)
  if (!checked.ok) {
    throw new ResolverError(name, 'invalid-output', `returned invalid output: ${checked.message}`)
  }
  return checked.value
}

/** Calls a registered computed function. Throws `ResolverError` on failure. */
export const runComputed = async ({
  name,
  definition,
  context,
}: {
  name: string
  definition: NotificationComputedDefinition
  context: NotificationDataContext
}): Promise<unknown> => {
  try {
    return await definition.handler(context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ResolverError(name, 'error', `failed: ${message}`, { cause: error })
  }
}

const describe = (
  registry: Record<string, { label?: string; description?: string; fields?: string[] }>,
): RegisteredDataFunction[] =>
  Object.entries(registry)
    .map(([name, definition]) => ({
      name,
      label: definition.label || name,
      description: definition.description,
      fields: definition.fields ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

/** Registered resolvers and computed functions for admin pickers — never their code. */
export const listDataFunctions = (options: {
  dataResolvers: Record<string, NotificationDataResolverDefinition>
  computed: Record<string, NotificationComputedDefinition>
}) => ({
  resolvers: describe(options.dataResolvers),
  computed: describe(options.computed),
})
