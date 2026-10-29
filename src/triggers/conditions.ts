import type { Payload } from 'payload'
import type {
  ConditionDefinition,
  ConditionOperator,
  FieldCondition,
  NotificationCondition,
  NotificationEvent,
} from '../types'
import { getPath, isObject, toRelationId } from '../data/paths'

export const CONDITION_OPERATORS: ConditionOperator[] = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'exists',
  'contains',
  'changed',
  'changedTo',
  'changedFrom',
]

const CHANGE_OPERATORS = new Set<ConditionOperator>(['changed', 'changedTo', 'changedFrom'])
const ORDER_OPERATORS = new Set<ConditionOperator>([
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
])

/** Roots that never need data sources. */
const PRE_DATA_ROOTS = new Set(['event', 'payload', 'doc', 'previous', 'trigger'])

const isFieldCondition = (condition: NotificationCondition): condition is FieldCondition =>
  isObject(condition) && 'field' in condition && 'operator' in condition

/** Relationship values compare by ID; scalars compare loosely by string. */
const normalize = (value: unknown): unknown => {
  if (isObject(value)) return toRelationId(value) ?? value
  return value
}

const isEqual = (a: unknown, b: unknown): boolean => {
  const left = normalize(a)
  const right = normalize(b)
  if (left === right) return true
  if (left === null || left === undefined || right === null || right === undefined) return false
  if (typeof left === 'object' || typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return String(left) === String(right)
}

/** Numbers compare numerically; ISO dates compare by time; other strings lexically. */
const compare = (a: unknown, b: unknown): number | undefined => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') {
    const numberA = Number(a)
    const numberB = Number(b)
    if (a.trim() && b.trim() && !Number.isNaN(numberA) && !Number.isNaN(numberB)) {
      return numberA - numberB
    }
    const timeA = Date.parse(a)
    const timeB = Date.parse(b)
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) return timeA - timeB
    return a.localeCompare(b)
  }
  if (typeof a === 'number' && typeof b === 'string' && b.trim() && !Number.isNaN(Number(b))) {
    return a - Number(b)
  }
  if (a instanceof Date || b instanceof Date) {
    const timeA = new Date(a as string).getTime()
    const timeB = new Date(b as string).getTime()
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) return timeA - timeB
  }
  return undefined
}

/**
 * Path on `previous` for a change operator: `doc.status` → `previous.status`;
 * a `document` source alias (`order.status`) maps the same way.
 */
export const previousPathFor = (field: string, documentAliases: Iterable<string> = []) => {
  const [root, ...rest] = field.split('.')
  if (root === 'doc' || new Set(documentAliases).has(root)) return ['previous', ...rest].join('.')
  return undefined
}

const evaluateField = (
  condition: FieldCondition,
  scope: Record<string, unknown>,
  documentAliases: string[],
): boolean => {
  const current = getPath(scope, condition.field)
  const { operator, value } = condition

  if (CHANGE_OPERATORS.has(operator)) {
    const previousPath = previousPathFor(condition.field, documentAliases)
    const previous = previousPath ? getPath(scope, previousPath) : undefined
    const changed = !isEqual(current, previous)
    if (operator === 'changed') return changed
    if (operator === 'changedTo') return changed && isEqual(current, value)
    return changed && isEqual(previous, value)
  }

  switch (operator) {
    case 'equals':
      return isEqual(current, value)
    case 'notEquals':
      return !isEqual(current, value)
    case 'in':
      return Array.isArray(value) && value.some((item) => isEqual(current, item))
    case 'notIn':
      return Array.isArray(value) && !value.some((item) => isEqual(current, item))
    case 'exists': {
      const present = current !== undefined && current !== null && current !== ''
      return value === false ? !present : present
    }
    case 'contains':
      if (typeof current === 'string') return typeof value === 'string' && current.includes(value)
      if (Array.isArray(current)) return current.some((item) => isEqual(item, value))
      return false
    default: {
      const result = compare(current, value)
      if (result === undefined) return false
      if (operator === 'greaterThan') return result > 0
      if (operator === 'greaterThanOrEqual') return result >= 0
      if (operator === 'lessThan') return result < 0
      return result <= 0
    }
  }
}

export type EvaluateConditionArgs = {
  scope: Record<string, unknown>
  event: NotificationEvent
  payload: Payload
  custom?: Record<string, ConditionDefinition>
  /** Aliases of `document` data sources (change operators read `previous` for them). */
  documentAliases?: string[]
}

/** Evaluates a condition tree. Unknown custom conditions evaluate to false. */
export const evaluateCondition = async (
  condition: NotificationCondition | undefined,
  args: EvaluateConditionArgs,
): Promise<boolean> => {
  if (!condition) return true
  if ('all' in condition) {
    for (const child of condition.all) {
      if (!(await evaluateCondition(child, args))) return false
    }
    return true
  }
  if ('any' in condition) {
    for (const child of condition.any) {
      if (await evaluateCondition(child, args)) return true
    }
    return false
  }
  if ('not' in condition) return !(await evaluateCondition(condition.not, args))
  if ('custom' in condition) {
    const definition = args.custom?.[condition.custom]
    if (!definition) return false
    return Boolean(
      await definition.handler({
        scope: args.scope,
        event: args.event,
        input: condition.input ?? {},
        payload: args.payload,
      }),
    )
  }
  return evaluateField(condition, args.scope, args.documentAliases ?? [])
}

/** Every field path and custom condition name a tree references. */
export const collectConditionRefs = (
  condition: NotificationCondition | undefined,
  refs: { fields: string[]; custom: string[] } = { fields: [], custom: [] },
) => {
  if (!condition || !isObject(condition)) return refs
  if ('all' in condition) condition.all.forEach((child) => collectConditionRefs(child, refs))
  else if ('any' in condition) condition.any.forEach((child) => collectConditionRefs(child, refs))
  else if ('not' in condition) collectConditionRefs(condition.not, refs)
  else if ('custom' in condition) refs.custom.push(condition.custom)
  else if (isFieldCondition(condition)) refs.fields.push(condition.field)
  return refs
}

/**
 * True when a tree can only be evaluated after data sources resolve: it reads a
 * source alias or calls a custom condition (which may read anything).
 */
export const conditionNeedsData = (condition: NotificationCondition | undefined): boolean => {
  const refs = collectConditionRefs(condition)
  return (
    refs.custom.length > 0 || refs.fields.some((field) => !PRE_DATA_ROOTS.has(field.split('.')[0]))
  )
}

export type ConditionValidationContext = {
  owner: string
  /** Data-source aliases and the fields each loads (undefined = any field). */
  aliases: Map<string, string[] | undefined>
  /** Aliases of `document` sources. */
  documentAliases: Set<string>
  /** Registered custom conditions. */
  custom: Iterable<string>
  /** Whether the trigger's source is a collection event (enables change operators and doc.*). */
  collectionSource: boolean
  /** Captured `doc` fields for collection sources. */
  capturedFields?: string[]
  /** Known event payload paths (from samplePayload); undefined = unknown, not checked. */
  payloadFields?: string[]
  /** Extra roots allowed (e.g. `recipient` for delivery `when`). */
  extraRoots?: string[]
}

const VALUE_REQUIRED = new Set<ConditionOperator>([
  'equals',
  'notEquals',
  'in',
  'notIn',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'contains',
  'changedTo',
  'changedFrom',
])

/**
 * Validates a condition tree's structure, operators, values and field
 * references. Returns `{ errors, warnings }`; unknown payload paths are
 * warnings because samples may omit optional fields.
 */
export const validateCondition = (
  condition: unknown,
  context: ConditionValidationContext,
): { errors: string[]; warnings: string[] } => {
  const errors: string[] = []
  const warnings: string[] = []
  const custom = new Set(context.custom)
  const extraRoots = new Set(context.extraRoots ?? [])
  const label = `${context.owner}:`

  const visit = (node: unknown, path: string) => {
    if (!isObject(node)) {
      errors.push(`${label} ${path} must be a condition object`)
      return
    }
    if ('all' in node || 'any' in node) {
      const key = 'all' in node ? 'all' : 'any'
      const children = node[key]
      if (!Array.isArray(children) || children.length === 0) {
        errors.push(`${label} ${path}.${key} must be a non-empty array`)
        return
      }
      children.forEach((child, index) => visit(child, `${path}.${key}[${index}]`))
      return
    }
    if ('not' in node) {
      visit(node.not, `${path}.not`)
      return
    }
    if ('custom' in node) {
      if (typeof node.custom !== 'string' || !custom.has(node.custom)) {
        errors.push(`${label} ${path} custom condition "${String(node.custom)}" is not registered`)
      }
      return
    }
    if (!('field' in node) || typeof node.field !== 'string' || !node.field) {
      errors.push(`${label} ${path} needs all / any / not / custom or a field`)
      return
    }

    const field = node.field
    const operator = node.operator as ConditionOperator
    const where = `${label} ${path} (${field})`
    if (!CONDITION_OPERATORS.includes(operator)) {
      errors.push(`${where} unknown operator "${String(node.operator)}"`)
      return
    }
    if (VALUE_REQUIRED.has(operator) && node.value === undefined) {
      errors.push(`${where} operator ${operator} needs a value`)
    }
    if ((operator === 'in' || operator === 'notIn') && !Array.isArray(node.value)) {
      errors.push(`${where} operator ${operator} needs an array value`)
    }
    if (
      ORDER_OPERATORS.has(operator) &&
      node.value !== undefined &&
      typeof node.value !== 'number' &&
      typeof node.value !== 'string'
    ) {
      errors.push(`${where} operator ${operator} needs a number or date string`)
    }

    const [root, ...rest] = field.split('.')
    const subPath = rest.join('.')

    if (CHANGE_OPERATORS.has(operator)) {
      if (!context.collectionSource) {
        errors.push(`${where} change operators need a collection event source`)
      } else if (root !== 'doc' && !context.documentAliases.has(root)) {
        errors.push(`${where} change operators compare doc.* (or a document source alias)`)
      }
    }

    if (root === 'doc' || root === 'previous') {
      if (!context.collectionSource) {
        errors.push(`${where} doc / previous are only available for collection event sources`)
      } else if (context.capturedFields && subPath && subPath !== 'id') {
        const top = subPath.split('.')[0]
        if (!context.capturedFields.includes(top)) {
          errors.push(`${where} field "${top}" is not captured for this collection`)
        }
      }
      return
    }
    if (root === 'event' || root === 'payload') {
      const payloadPath = root === 'payload' ? subPath : subPath.replace(/^payload\.?/, '')
      if (
        context.payloadFields &&
        (root === 'payload' || subPath.startsWith('payload.')) &&
        payloadPath &&
        !context.payloadFields.some(
          (known) => known === payloadPath || known.startsWith(`${payloadPath}.`),
        )
      ) {
        warnings.push(`${where} payload path "${payloadPath}" is not in the event's samplePayload`)
      }
      return
    }
    if (root === 'trigger' || extraRoots.has(root)) return
    if (!context.aliases.has(root)) {
      errors.push(
        `${where} unknown root "${root}" (use event, payload, doc, previous or a data source alias)`,
      )
      return
    }
    const fields = context.aliases.get(root)
    const top = subPath.split('.')[0]
    if (fields && top && top !== 'id' && !fields.includes(top)) {
      errors.push(`${where} source "${root}" does not load field "${top}"`)
    }
  }

  if (condition !== undefined) visit(condition, 'conditions')
  return { errors, warnings }
}
