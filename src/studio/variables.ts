import { compile } from '../templates/engine'
import { inlineExpressions } from './inline'
import { walkBlocks, type EmailBlock, type EmailDesign } from './model'

/**
 * Variable roots the context provides: `{ payload: ['orderId', …], recipient: [...] }`.
 * `null` or an empty list means any field of that root.
 */
export type VariableRoots = Record<string, string[] | null>

/** Variable path an engine expression reads (`date payload.at "d"` → `payload.at`). */
export const expressionPath = (expression: string): string | undefined => {
  try {
    const node = compile(`{{ ${expression} }}`).ast[0]
    return node && node.type === 'variable' ? node.path : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a path is provided. Inside loops (`loopPaths`), paths whose root is
 * not a context root are fields of the current item and count as provided.
 */
export const isProvided = (
  path: string,
  roots: VariableRoots,
  loopPaths: string[] = [],
): boolean => {
  const [root, field] = path.split('.')
  if (root === 'this' || root.startsWith('@')) return loopPaths.length > 0
  if (!(root in roots)) return loopPaths.length > 0
  const fields = roots[root]
  return !field || !fields || fields.length === 0 || fields.includes(field)
}

const blockTexts = (block: EmailBlock): string[] => {
  switch (block.type) {
    case 'heading':
    case 'text':
      return [block.text]
    case 'button':
      return [block.label, block.href]
    case 'image':
      return [block.alt, block.href ?? '', block.src ?? '']
    case 'list':
      return block.items
    case 'footer':
      return [block.text]
    case 'loop':
      return [block.emptyText ?? '']
    case 'social':
      return block.links.map((link) => link.url)
    default:
      return []
  }
}

export type VariableIssue = { message: string; path?: string; expression?: string }

/** Unknown or invalid variables per block ID, aware of loop blocks. */
export const designVariableIssues = (
  design: EmailDesign,
  roots: VariableRoots,
): Record<string, VariableIssue[]> => {
  const problems: Record<string, VariableIssue[]> = {}
  walkBlocks(design.blocks, (block, parents) => {
    const loops = parents
      .filter((parent) => parent.type === 'loop')
      .map((parent) => (parent as { path: string }).path)
    const issues = new Map<string, VariableIssue>()
    const unknown = (path: string, expression?: string) =>
      issues.set(path, {
        message: `"${path}" is not provided by the selected event`,
        path,
        expression,
      })
    for (const text of blockTexts(block)) {
      for (const expression of inlineExpressions(text)) {
        const path = expressionPath(expression)
        if (!path) {
          issues.set(expression, {
            message: `"{{ ${expression} }}" is not a valid variable`,
            expression,
          })
        } else if (!isProvided(path, roots, loops)) unknown(path, expression)
      }
    }
    if ((block.type === 'loop' || block.type === 'conditional') && block.path) {
      if (!isProvided(block.path, roots, loops)) unknown(block.path)
    }
    if (issues.size) problems[block.id] = [...issues.values()]
  })
  return problems
}

/** The `{{` expression being typed at the caret, for autocomplete. */
export const autocompleteQuery = (
  value: string,
  caret: number,
): { start: number; query: string } | null => {
  const before = value.slice(0, caret)
  const open = before.lastIndexOf('{{')
  if (open < 0 || before.indexOf('}}', open) >= 0) return null
  const query = before.slice(open + 2).trimStart()
  if (/[\s{}]/.test(query)) return null
  return { start: open, query }
}

/** Replaces the typed `{{ query` with `{{ path }}`; returns the new value and caret. */
export const applySuggestion = (
  value: string,
  caret: number,
  start: number,
  path: string,
): { value: string; caret: number } => {
  const after = value.slice(caret)
  const closing = after.trimStart().startsWith('}}')
  const rest = closing ? after.trimStart().slice(2) : after
  const inserted = `{{ ${path} }}`
  return { value: value.slice(0, start) + inserted + rest, caret: start + inserted.length }
}

/** Suggestions for a query: paths starting with it first, then paths containing it. */
export const suggestVariables = (paths: string[], query: string, limit = 12): string[] => {
  const q = query.toLowerCase()
  const starts = paths.filter((path) => path.toLowerCase().startsWith(q))
  const contains = paths.filter(
    (path) => !path.toLowerCase().startsWith(q) && path.toLowerCase().includes(q),
  )
  return [...starts, ...contains].slice(0, limit)
}
