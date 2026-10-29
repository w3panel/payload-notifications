import type {
  ConditionOperator,
  NotificationCondition,
  NotificationDataSource,
  NotificationDeliveryDefinition,
  NotificationRecipientDefinition,
  NotificationSchedule,
  NotificationScheduleOptions,
  TriggerSource,
} from '../types'

/** Picker data served by `GET /api/payload-notifications/registry`. */
export type BuilderRegistry = {
  channels: string[]
  classifications: string[]
  events: Array<{
    name: string
    label: string
    fields: string[]
    samplePayload?: Record<string, unknown>
  }>
  collections: Array<{ slug: string; label: string; fields: string[] }>
  collectionEvents: Array<{ slug: string; label: string; operations: string[]; capture: string[] }>
  resolvers: Array<{ name: string; label: string; fields: string[] }>
  computed: Array<{ name: string; label: string; fields: string[] }>
  recipientResolvers: Array<{ name: string; label: string }>
  recipientQueries: Array<{ name: string; label: string }>
  conditions: Array<{ name: string; label: string }>
  operators: ConditionOperator[]
  recipientTypes: string[]
  templates: Array<{ slug: string; source: 'code' | 'db'; status: string; channels: string[] }>
}

export const EMPTY_REGISTRY: BuilderRegistry = {
  channels: [],
  classifications: ['transactional', 'marketing'],
  events: [],
  collections: [],
  collectionEvents: [],
  resolvers: [],
  computed: [],
  recipientResolvers: [],
  recipientQueries: [],
  conditions: [],
  operators: [],
  recipientTypes: [],
  templates: [],
}

export const BUILDER_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'data', label: 'Data sources' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'test', label: 'Test & publish' },
] as const
export type BuilderStep = (typeof BUILDER_STEPS)[number]['key']

export const CHANGE_OPERATORS: ConditionOperator[] = ['changed', 'changedTo', 'changedFrom']
const NO_VALUE: ConditionOperator[] = ['exists', 'changed']
const LIST_VALUE: ConditionOperator[] = ['in', 'notIn']

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'equals',
  notEquals: 'does not equal',
  in: 'is one of',
  notIn: 'is not one of',
  greaterThan: '>',
  greaterThanOrEqual: '≥',
  lessThan: '<',
  lessThanOrEqual: '≤',
  exists: 'is set',
  contains: 'contains',
  changed: 'changed',
  changedTo: 'changed to',
  changedFrom: 'changed from',
}

/** Operators offered for a field: change operators only for doc fields of collection triggers. */
export const operatorsFor = (
  field: string,
  operators: ConditionOperator[],
  collectionSource: boolean,
): ConditionOperator[] => {
  const isDocField = field.startsWith('doc.')
  return operators.filter((operator) =>
    CHANGE_OPERATORS.includes(operator) ? collectionSource && isDocField : true,
  )
}

export const operatorNeedsValue = (operator: ConditionOperator) => !NO_VALUE.includes(operator)

/** Parses an input string into a condition value: lists for in / notIn, numbers and booleans when unambiguous. */
export const parseConditionValue = (operator: ConditionOperator, raw: string): unknown => {
  const scalar = (text: string): unknown => {
    const value = text.trim()
    if (value === 'true') return true
    if (value === 'false') return false
    if (value !== '' && !Number.isNaN(Number(value))) return Number(value)
    return value
  }
  if (LIST_VALUE.includes(operator)) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(scalar)
  }
  if (operator === 'exists') return raw.trim() === 'false' ? false : undefined
  return scalar(raw)
}

export const formatConditionValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (value === undefined || value === null) return ''
  return String(value)
}

export type ConditionGroup = { all: NotificationCondition[] } | { any: NotificationCondition[] }

export const isGroup = (node: NotificationCondition | undefined): node is ConditionGroup =>
  Boolean(node && typeof node === 'object' && ('all' in node || 'any' in node))

export const groupChildren = (group: ConditionGroup): NotificationCondition[] =>
  'all' in group ? group.all : group.any

const withChildren = (group: ConditionGroup, children: NotificationCondition[]): ConditionGroup =>
  'all' in group ? { all: children } : { any: children }

/** Editing always happens on a group so rules can be added; a single rule is wrapped. */
export const toEditableGroup = (condition: NotificationCondition | undefined): ConditionGroup => {
  if (!condition) return { all: [] }
  if (isGroup(condition)) return condition
  return { all: [condition] }
}

/** Index path into nested groups, e.g. `[1, 0]` = second child's first child. */
export type NodePath = number[]

const updateAt = (
  group: ConditionGroup,
  path: NodePath,
  update: (
    node: NotificationCondition | undefined,
    children: NotificationCondition[],
    index: number,
  ) => NotificationCondition[],
): ConditionGroup => {
  const children = [...groupChildren(group)]
  const [index, ...rest] = path
  if (!rest.length) return withChildren(group, update(children[index], children, index))
  const child = children[index]
  if (!isGroup(child)) return group
  children[index] = updateAt(child, rest, update)
  return withChildren(group, children)
}

export const newRule = (
  field = 'event.payload',
  operator: ConditionOperator = 'equals',
): NotificationCondition => ({
  field,
  operator,
  value: '',
})

/** Appends a rule (or a nested group) to the group at `path` (`[]` = root). */
export const addNode = (
  root: ConditionGroup,
  path: NodePath,
  node: NotificationCondition,
): ConditionGroup => {
  if (!path.length) return withChildren(root, [...groupChildren(root), node])
  return updateAt(root, path, (target, children, index) => {
    if (!isGroup(target)) return children
    children[index] = withChildren(target, [...groupChildren(target), node])
    return children
  })
}

export const replaceNode = (
  root: ConditionGroup,
  path: NodePath,
  node: NotificationCondition,
): ConditionGroup =>
  updateAt(root, path, (_target, children, index) => {
    children[index] = node
    return children
  })

export const removeNode = (root: ConditionGroup, path: NodePath): ConditionGroup =>
  updateAt(root, path, (_target, children, index) => children.filter((_, i) => i !== index))

/** Switches a group between all (AND) and any (OR), keeping its children. */
export const toggleGroupType = (group: ConditionGroup): ConditionGroup =>
  'all' in group ? { any: group.all } : { all: group.any }

/** Drops empty groups; returns undefined for an empty tree (no conditions). */
export const cleanCondition = (
  condition: NotificationCondition | undefined,
): NotificationCondition | undefined => {
  if (!condition) return undefined
  if (isGroup(condition)) {
    const children = groupChildren(condition)
      .map(cleanCondition)
      .filter((child): child is NotificationCondition => Boolean(child))
    return children.length ? withChildren(condition, children) : undefined
  }
  if ('not' in condition) {
    const inner = cleanCondition(condition.not)
    return inner ? { not: inner } : undefined
  }
  return condition
}

type BuilderDefinition = {
  source?: TriggerSource
  data?: { sources?: NotificationDataSource[] }
}

/**
 * Field paths offered in condition pickers: event payload fields, captured doc
 * / previous fields, data-source fields and (for delivery `when`) recipient.*.
 */
export const suggestFields = (
  registry: BuilderRegistry,
  definition: BuilderDefinition,
  { recipient = false }: { recipient?: boolean } = {},
): string[] => {
  const fields: string[] = []
  const source = definition.source

  if (source?.type === 'event') {
    const prefix = source.event.endsWith('.*') ? source.event.slice(0, -1) : undefined
    for (const event of registry.events) {
      if (
        event.name === source.event ||
        (prefix && event.name.startsWith(prefix)) ||
        source.event === '*'
      ) {
        fields.push(...event.fields.map((field) => `event.payload.${field}`))
      }
    }
  } else if (source?.type === 'collection') {
    const config = registry.collectionEvents.find((entry) => entry.slug === source.collection)
    for (const field of config?.capture ?? []) fields.push(`doc.${field}`, `previous.${field}`)
  }

  for (const dataSource of definition.data?.sources ?? []) {
    if (dataSource.type === 'collection') {
      fields.push(...['id', ...dataSource.fields].map((field) => `${dataSource.alias}.${field}`))
    } else if (dataSource.type === 'document') {
      const config =
        source?.type === 'collection'
          ? registry.collectionEvents.find((entry) => entry.slug === source.collection)
          : undefined
      const available = dataSource.fields?.length ? dataSource.fields : (config?.capture ?? [])
      fields.push(...available.map((field) => `${dataSource.alias}.${field}`))
    } else if (dataSource.type === 'resolver' || dataSource.type === 'computed') {
      const list = dataSource.type === 'resolver' ? registry.resolvers : registry.computed
      const known = list.find((entry) => entry.name === dataSource.name)?.fields ?? []
      fields.push(...known.map((field) => `${dataSource.alias}.${field}`))
    }
  }

  if (recipient)
    fields.push('recipient.id', 'recipient.name', 'recipient.email', 'recipient.locale')
  return [...new Set(fields)]
}

/** Templates that have content for a channel. */
export const templatesForChannel = (registry: BuilderRegistry, channel: string) =>
  registry.templates.filter((template) => template.channels.includes(channel))

/** Aliases deliveries can target (plus `all`). */
export const recipientAliases = (recipients: NotificationRecipientDefinition[] | undefined) => [
  'all',
  ...(recipients ?? [{ type: 'eventUser' as const }]).map(
    (recipient, index) =>
      recipient.alias || (recipient.type === 'eventUser' ? 'user' : `recipient${index}`),
  ),
]

export const newDataSource = (
  type: NotificationDataSource['type'],
  index: number,
): NotificationDataSource => {
  const alias = `source${index + 1}`
  switch (type) {
    case 'collection':
      return {
        type,
        alias,
        collection: '',
        lookup: { type: 'id', from: 'event.payload.' },
        fields: [],
      }
    case 'resolver':
    case 'computed':
      return { type, alias, name: '' }
    default:
      return { type, alias }
  }
}

export const newRecipient = (
  type: NotificationRecipientDefinition['type'],
  index: number,
): NotificationRecipientDefinition => {
  const alias = type === 'eventUser' ? 'user' : `recipient${index + 1}`
  switch (type) {
    case 'context':
    case 'relationship':
      return { type, alias, path: '' }
    case 'static':
      return { type, alias, email: '' }
    case 'role':
      return { type, alias, role: '' }
    case 'resolver':
    case 'query':
      return { type, alias, name: '' }
    default:
      return { type: 'eventUser', alias }
  }
}

export const newDelivery = (registry: BuilderRegistry): NotificationDeliveryDefinition => {
  const channel = (registry.channels[0] ?? 'email') as NotificationDeliveryDefinition['channel']
  return {
    channel,
    template: templatesForChannel(registry, channel)[0]?.slug ?? '',
    recipient: 'all',
  }
}

export type BuilderSchedule = NotificationSchedule & NotificationScheduleOptions

export const scheduleOfType = (
  type: BuilderSchedule['type'],
  current?: BuilderSchedule,
): BuilderSchedule | undefined => {
  const options = { recheckConditions: current?.recheckConditions, skipIfPast: current?.skipIfPast }
  switch (type) {
    case 'delay':
      return { type, delay: '1h', ...options }
    case 'at':
      return { type, at: 'event.payload.sendAt', ...options }
    case 'relative':
      return { type, at: '', offset: '-24h', ...options }
    default:
      return undefined
  }
}

/** Sample payload JSON for the test step: the registered event's samplePayload. */
export const sampleFor = (registry: BuilderRegistry, source: TriggerSource | undefined): string => {
  if (source?.type !== 'event') return '{}'
  const event = registry.events.find((entry) => entry.name === source.event)
  return JSON.stringify(event?.samplePayload ?? {}, null, 2)
}
