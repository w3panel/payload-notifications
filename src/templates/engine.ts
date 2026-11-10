/**
 * Handlebars-subset template engine.
 *
 * Supports:
 *  - Variable interpolation: {{ name }}, {{ payload.order.id }}
 *  - Conditionals: {{#if cond}}...{{else}}...{{/if}}
 *  - Loops: {{#each items}}...{{/each}}
 *  - Formatters: {{ date createdAt "MMM d, yyyy" }}, {{ currency amount "USD" }}
 *  - HTML auto-escaping (triple-brace {{{ raw }}} to bypass)
 *  - Default values: {{ name | default "Guest" }}
 *  - Nested property access via dot notation
 *
 * Zero external dependencies. Uses Intl APIs for date/currency formatting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateNode =
  | { type: 'text'; value: string }
  | {
      type: 'variable'
      path: string
      raw: boolean
      formatter?: FormatterCall
      defaultValue?: string
    }
  | { type: 'if'; path: string; body: TemplateNode[]; elseBody: TemplateNode[] }
  | { type: 'each'; path: string; body: TemplateNode[] }

type FormatterCall = {
  name: string
  args: string[]
}

export type CompiledTemplate = {
  ast: TemplateNode[]
  source: string
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = [
  /\bnew\s+/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bconstructor\b/,
  /\b__proto__\b/,
  /\bprototype\b/,
]

/** Only `{{ … }}` expressions are evaluated, so only they are checked; literal copy such as
 * "a new order" is plain text. */
const EXPRESSION = /\{\{\{?([\s\S]*?)\}?\}\}/g

const validateSecurity = (source: string): void => {
  const expressions = Array.from(source.matchAll(EXPRESSION), (match) => match[1]).join('\n')
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(expressions)) {
      throw new Error(`Template security violation: forbidden pattern detected`)
    }
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'text'; value: string }
  | { type: 'open_raw'; content: string }
  | { type: 'open'; content: string }
  | { type: 'open_block'; name: string; arg: string }
  | { type: 'else' }
  | { type: 'close_block'; name: string }

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let cursor = 0

  while (cursor < source.length) {
    // Raw triple-brace: {{{ ... }}}
    const rawOpen = source.indexOf('{{{', cursor)
    const exprOpen = source.indexOf('{{', cursor)

    if (rawOpen === cursor) {
      const rawClose = source.indexOf('}}}', cursor + 3)
      if (rawClose === -1) {
        throw new Error('Unclosed raw expression {{{ ... }}}')
      }
      tokens.push({ type: 'open_raw', content: source.slice(cursor + 3, rawClose).trim() })
      cursor = rawClose + 3
      continue
    }

    if (exprOpen === -1) {
      // Rest is plain text
      tokens.push({ type: 'text', value: source.slice(cursor) })
      break
    }

    if (exprOpen > cursor) {
      tokens.push({ type: 'text', value: source.slice(cursor, exprOpen) })
      cursor = exprOpen
      continue
    }

    // We're at {{
    const exprClose = source.indexOf('}}', cursor + 2)
    if (exprClose === -1) {
      throw new Error('Unclosed expression {{ ... }}')
    }

    const content = source.slice(cursor + 2, exprClose).trim()
    cursor = exprClose + 2

    // Block helpers: {{#if ...}}, {{#each ...}}
    if (content.startsWith('#')) {
      const spaceIdx = content.indexOf(' ')
      const name = spaceIdx === -1 ? content.slice(1) : content.slice(1, spaceIdx)
      const arg = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim()
      tokens.push({ type: 'open_block', name, arg })
      continue
    }

    // Closing blocks: {{/if}}, {{/each}}
    if (content.startsWith('/')) {
      tokens.push({ type: 'close_block', name: content.slice(1).trim() })
      continue
    }

    // Else
    if (content === 'else') {
      tokens.push({ type: 'else' })
      continue
    }

    // Regular expression
    tokens.push({ type: 'open', content })
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const parseFormatter = (
  content: string,
): { path: string; formatter?: FormatterCall; defaultValue?: string } => {
  // Default value: {{ name | default "Guest" }}
  const defaultMatch = content.match(/^(.+?)\s*\|\s*default\s+"([^"]*)"$/)
  if (defaultMatch) {
    return { path: defaultMatch[1].trim(), defaultValue: defaultMatch[2] }
  }
  const defaultMatchSingle = content.match(/^(.+?)\s*\|\s*default\s+'([^']*)'$/)
  if (defaultMatchSingle) {
    return { path: defaultMatchSingle[1].trim(), defaultValue: defaultMatchSingle[2] }
  }

  // Formatter: {{ date createdAt "MMM d, yyyy" }} or {{ currency amount "USD" }}
  const formatterMatch = content.match(/^(\w+)\s+(.+?)(?:\s+"([^"]*)")?$/)
  if (formatterMatch) {
    const possibleFormatter = formatterMatch[1]
    if (BUILTIN_FORMATTERS.has(possibleFormatter)) {
      const args = formatterMatch[3] !== undefined ? [formatterMatch[3]] : []
      return {
        path: formatterMatch[2].trim(),
        formatter: { name: possibleFormatter, args },
      }
    }
  }

  return { path: content }
}

const BUILTIN_FORMATTERS = new Set([
  'date',
  'currency',
  'uppercase',
  'lowercase',
  'capitalize',
  'truncate',
])

const parseTokens = (tokens: Token[], maxDepth: number, depth = 0): TemplateNode[] => {
  if (depth > maxDepth) {
    throw new Error(`Template nesting exceeds maximum depth of ${maxDepth}`)
  }

  const nodes: TemplateNode[] = []
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'text') {
      nodes.push({ type: 'text', value: token.value })
      i++
      continue
    }

    if (token.type === 'open_raw') {
      const { path, formatter, defaultValue } = parseFormatter(token.content)
      nodes.push({ type: 'variable', path, raw: true, formatter, defaultValue })
      i++
      continue
    }

    if (token.type === 'open') {
      const { path, formatter, defaultValue } = parseFormatter(token.content)
      nodes.push({ type: 'variable', path, raw: false, formatter, defaultValue })
      i++
      continue
    }

    if (token.type === 'open_block') {
      if (token.name === 'if') {
        const { body, elseBody, endIndex } = parseBlock(tokens, i, 'if', maxDepth, depth)
        nodes.push({ type: 'if', path: token.arg, body, elseBody })
        i = endIndex + 1
        continue
      }

      if (token.name === 'each') {
        const { body, endIndex } = parseBlock(tokens, i, 'each', maxDepth, depth)
        nodes.push({ type: 'each', path: token.arg, body })
        i = endIndex + 1
        continue
      }

      throw new Error(`Unknown block helper: ${token.name}`)
    }

    // close_block or else at top level means mismatched blocks
    if (token.type === 'close_block' || token.type === 'else') {
      break
    }

    i++
  }

  return nodes
}

const parseBlock = (
  tokens: Token[],
  startIndex: number,
  blockName: string,
  maxDepth: number,
  depth: number,
): { body: TemplateNode[]; elseBody: TemplateNode[]; endIndex: number } => {
  const bodyTokens: Token[] = []
  const elseTokens: Token[] = []
  let inElse = false
  let nestedDepth = 0
  let i = startIndex + 1

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'open_block') {
      nestedDepth++
      ;(inElse ? elseTokens : bodyTokens).push(token)
      i++
      continue
    }

    if (token.type === 'close_block') {
      if (nestedDepth > 0) {
        nestedDepth--
        ;(inElse ? elseTokens : bodyTokens).push(token)
        i++
        continue
      }
      if (token.name === blockName) {
        // This is our closing tag at the correct nesting level
        return {
          body: parseTokens(bodyTokens, maxDepth, depth + 1),
          elseBody: parseTokens(elseTokens, maxDepth, depth + 1),
          endIndex: i,
        }
      }
      throw new Error(`Unexpected closing block: {{/${token.name}}} inside {{#${blockName}}}`)
    }

    if (token.type === 'else' && nestedDepth === 0) {
      inElse = true
      i++
      continue
    }

    ;(inElse ? elseTokens : bodyTokens).push(token)
    i++
  }

  throw new Error(`Unclosed block: {{#${blockName}}}`)
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export type CompileOptions = {
  maxDepth?: number
}

export const compile = (source: string, options: CompileOptions = {}): CompiledTemplate => {
  validateSecurity(source)
  const maxDepth = options.maxDepth ?? 5
  const tokens = tokenize(source)
  const ast = parseTokens(tokens, maxDepth)
  return { ast, source }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const applyFormatter = (value: unknown, formatter: FormatterCall): string => {
  const str = stringifyValue(value)

  switch (formatter.name) {
    case 'uppercase':
      return str.toUpperCase()
    case 'lowercase':
      return str.toLowerCase()
    case 'capitalize':
      return str.charAt(0).toUpperCase() + str.slice(1)
    case 'truncate': {
      const len = formatter.args[0] ? parseInt(formatter.args[0], 10) : 50
      return str.length > len ? str.slice(0, len) + '...' : str
    }
    case 'date': {
      const dateVal = value instanceof Date ? value : new Date(String(value))
      if (isNaN(dateVal.getTime())) return str
      try {
        const opts = parseDateFormat(formatter.args[0])
        return new Intl.DateTimeFormat('en-US', opts).format(dateVal)
      } catch {
        return dateVal.toLocaleDateString('en-US')
      }
    }
    case 'currency': {
      const num = typeof value === 'number' ? value : parseFloat(str)
      if (isNaN(num)) return str
      const currencyCode = formatter.args[0] || 'USD'
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
          num,
        )
      } catch {
        return str
      }
    }
    default:
      return str
  }
}

const parseDateFormat = (format?: string): Intl.DateTimeFormatOptions => {
  if (!format) return { dateStyle: 'medium' }

  const opts: Intl.DateTimeFormatOptions = {}

  if (format.includes('yyyy') || format.includes('YYYY')) opts.year = 'numeric'
  else if (format.includes('yy')) opts.year = '2-digit'

  if (format.includes('MMMM')) opts.month = 'long'
  else if (format.includes('MMM')) opts.month = 'short'
  else if (format.includes('MM') || format.includes('M')) opts.month = 'numeric'

  if (format.includes('dd') || format.includes('d')) opts.day = 'numeric'

  if (format.includes('HH') || format.includes('hh') || format.includes('h')) opts.hour = 'numeric'
  if (format.includes('mm') || format.includes('m')) opts.minute = 'numeric'
  if (format.includes('ss') || format.includes('s')) opts.second = 'numeric'

  if (Object.keys(opts).length === 0) return { dateStyle: 'medium' }
  return opts
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return value.toString()
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return '[unserializable]'
  }
}

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const resolvePath = (context: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(key)
      return Number.isNaN(index) ? undefined : current[index]
    }
    if (typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, context)
}

const isTruthy = (value: unknown): boolean => {
  if (value === null || value === undefined || value === false || value === 0 || value === '') {
    return false
  }
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

const renderNodes = (nodes: TemplateNode[], context: Record<string, unknown>): string => {
  let output = ''

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        output += node.value
        break

      case 'variable': {
        let value = resolvePath(context, node.path)
        if (
          (value === null || value === undefined || value === '') &&
          node.defaultValue !== undefined
        ) {
          value = node.defaultValue
        }
        let str: string
        if (node.formatter) {
          str = applyFormatter(value, node.formatter)
        } else {
          str = stringifyValue(value)
        }
        output += node.raw ? str : escapeHtml(str)
        break
      }

      case 'if': {
        const condValue = resolvePath(context, node.path)
        if (isTruthy(condValue)) {
          output += renderNodes(node.body, context)
        } else {
          output += renderNodes(node.elseBody, context)
        }
        break
      }

      case 'each': {
        const items = resolvePath(context, node.path)
        if (Array.isArray(items)) {
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx]
            const itemCtx =
              typeof item === 'object' && item !== null
                ? {
                    ...context,
                    ...item,
                    '@index': idx,
                    '@first': idx === 0,
                    '@last': idx === items.length - 1,
                    this: item,
                  }
                : {
                    ...context,
                    this: item,
                    '@index': idx,
                    '@first': idx === 0,
                    '@last': idx === items.length - 1,
                  }
            output += renderNodes(node.body, itemCtx)
          }
        }
        break
      }
    }
  }

  return output
}

export const render = (compiled: CompiledTemplate, context: Record<string, unknown>): string => {
  return renderNodes(compiled.ast, context)
}

// ---------------------------------------------------------------------------
// Convenience: compile + render in one call
// ---------------------------------------------------------------------------

export const renderTemplate = (
  source: string,
  context: Record<string, unknown>,
  options?: CompileOptions,
): string => {
  const compiled = compile(source, options)
  return render(compiled, context)
}
