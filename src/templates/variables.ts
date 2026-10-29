import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTrigger,
} from '../types'
import { collectFieldPaths } from '../events/registry'
import { compile, type TemplateNode } from './engine'

/** Paths every notification context provides. */
export const BASE_TEMPLATE_PATHS = [
  'event',
  'userId',
  'trigger.name',
  'trigger.eventId',
  'trigger.occurredAt',
  'trigger.classification',
  'trigger.tenant',
  'recipient.id',
  'recipient.name',
  'recipient.email',
  'recipient.locale',
  'recipient.timezone',
  'unsubscribeUrl',
]

const LOOP_LOCALS = new Set(['this', '@index', '@first', '@last'])

/**
 * Paths a template reads. Inside `{{#each list}}`, references whose root is not
 * a known context root are item fields and are reported as `list.0.field`.
 */
export const extractTemplatePaths = (
  source: string,
  knownRoots: Iterable<string> = [],
): string[] => {
  const roots = new Set([
    ...knownRoots,
    'event',
    'userId',
    'payload',
    'trigger',
    'recipient',
    'doc',
    'previous',
  ])
  const paths = new Set<string>()

  const walk = (nodes: TemplateNode[], loops: string[]) => {
    const qualify = (path: string) => {
      const root = path.split('.')[0]
      const loop = loops[loops.length - 1]
      if (!loop) return path
      if (LOOP_LOCALS.has(root)) {
        return root === 'this' ? `${loop}.0${path.slice(4)}` : undefined
      }
      return roots.has(root) ? path : `${loop}.0.${path}`
    }
    for (const node of nodes) {
      if (node.type === 'text') continue
      const path = qualify(node.path)
      if (path) paths.add(path)
      if (node.type === 'if') {
        walk(node.body, loops)
        walk(node.elseBody, loops)
      } else if (node.type === 'each') {
        walk(node.body, [...loops, path ?? node.path])
      }
    }
  }

  walk(compile(source).ast, [])
  return [...paths]
}

/** All template sources of a definition (subject, title, bodies). */
export const definitionSources = (definition: Partial<NotificationTemplateDefinition>): string[] =>
  [
    definition.subject,
    definition.title,
    definition.body,
    definition.textBody,
    definition.htmlBody,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

export type AvailableVariables = {
  /** Concrete paths offered to authors (for autocomplete). */
  paths: string[]
  /** Roots whose fields are known (`order` → ['total', …]); undefined = any field. */
  roots: Map<string, string[] | undefined>
}

/**
 * Variables available to templates sent for an event or trigger: the base
 * context, the event's sample payload, captured `doc` / `previous` fields and
 * data-source aliases.
 */
export const availableVariables = (
  options: Pick<
    NormalizedNotificationsPluginOptions,
    'events' | 'collectionEvents' | 'dataResolvers' | 'computed'
  >,
  { event, trigger }: { event?: string; trigger?: NotificationTrigger } = {},
): AvailableVariables => {
  const roots = new Map<string, string[] | undefined>([
    ['event', []],
    ['userId', []],
    ['trigger', ['name', 'eventId', 'occurredAt', 'classification', 'tenant']],
    ['recipient', ['id', 'name', 'email', 'locale', 'timezone', 'aliases']],
    ['unsubscribeUrl', []],
  ])
  const paths = [...BASE_TEMPLATE_PATHS]

  const eventName = trigger?.source.type === 'event' ? trigger.source.event : event
  const sample = eventName ? options.events[eventName]?.samplePayload : undefined
  if (sample) {
    const fields = collectFieldPaths(sample)
    roots.set('payload', [...new Set(fields.map((field) => field.split('.')[0]))])
    paths.push(...fields.map((field) => `payload.${field}`))
  } else {
    roots.set('payload', undefined)
  }

  if (trigger?.source.type === 'collection') {
    const capture = options.collectionEvents[trigger.source.collection]?.capture ?? []
    roots.set('doc', ['id', ...capture])
    roots.set('previous', ['id', ...capture])
    paths.push(...capture.flatMap((field) => [`doc.${field}`, `previous.${field}`]))
  }

  for (const source of trigger?.data?.sources ?? []) {
    let fields: string[] | undefined
    if (source.type === 'collection') fields = ['id', ...source.fields]
    else if (source.type === 'document')
      fields = source.fields?.length ? ['id', ...source.fields] : roots.get('doc')
    else if (source.type === 'resolver') fields = options.dataResolvers[source.name]?.fields
    else if (source.type === 'computed') fields = options.computed[source.name]?.fields
    roots.set(source.alias, fields?.length ? fields : undefined)
    paths.push(...(fields ?? []).map((field) => `${source.alias}.${field}`))
  }

  return { paths: [...new Set(paths)], roots }
}

export type VariableCheck = {
  /** Paths the template uses that the context does not provide. */
  unknown: string[]
  /** Declared required variables the context does not provide. */
  missingRequired: string[]
}

const provides = (available: AvailableVariables, path: string): boolean => {
  const [root, field] = path.split('.')
  if (!available.roots.has(root)) return false
  const fields = available.roots.get(root)
  return !field || fields === undefined || fields.length === 0 || fields.includes(field)
}

/** Compares a template's variables with what the context provides. */
export const checkTemplateVariables = (
  sources: string[],
  available: AvailableVariables,
  declared: Array<{ name?: string; required?: boolean }> = [],
): VariableCheck => {
  const used = new Set(
    sources.flatMap((source) => extractTemplatePaths(source, available.roots.keys())),
  )
  return {
    unknown: [...used].filter((path) => !provides(available, path)).sort(),
    missingRequired: declared
      .filter(
        (variable) => variable.required && variable.name && !provides(available, variable.name),
      )
      .map((variable) => variable.name as string),
  }
}

/** Channels in a template document that have content. */
export const TEMPLATE_CHANNELS: NotificationChannel[] = ['email', 'sms', 'whatsapp', 'inapp']
