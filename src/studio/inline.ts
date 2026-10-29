/**
 * Inline markup used in visual designer text: `**bold**`, `_italic_`,
 * `[label](url)` and `{{ expression }}` variables.
 *
 * Only plain `{{ … }}` expressions reach the template engine, which escapes
 * their values. Triple braces (raw output) and block tags (`{{#if}}`,
 * `{{/each}}`, `{{else}}`) typed into text are shown literally; loops and
 * conditions come from loop / conditional blocks only.
 */

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // A brace pair left in literal text must not open an engine tag.
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')

const TOKEN =
  /\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|\[([^\]\n]*)\]\(((?:\{\{[^{}\n]*\}\}|[^()\s]|\([^()\s]*\))*)\)/g

/** True for `{{ expression }}` that may be passed to the engine. */
const isExpression = (token: string) => {
  if (token.startsWith('{{{')) return false
  const inner = token.slice(2, -2).trim()
  if (!inner || /[{}]/.test(inner)) return false
  return !/^(#|\/|else\b|>|!)/.test(inner)
}

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/** Link targets: http(s), mailto, tel, relative, or starting with a variable. Others are dropped. */
export const safeHref = (href: string): string | undefined => {
  const value = href.trim()
  if (!value) return undefined
  if (value.startsWith('{{')) {
    const end = value.indexOf('}}')
    return end > 0 && isExpression(value.slice(0, end + 2)) ? value : undefined
  }
  return SAFE_URL.test(value) ? value : undefined
}

/** Escapes an attribute value but keeps `{{ expressions }}` for the engine (which escapes them). */
export const attr = (value: string): string => {
  let out = ''
  let last = 0
  for (const match of value.matchAll(/\{\{[\s\S]*?\}\}/g)) {
    const token = match[0]
    out += escapeHtml(value.slice(last, match.index))
    out += isExpression(token) ? `{{ ${token.slice(2, -2).trim()} }}` : escapeHtml(token)
    last = (match.index ?? 0) + token.length
  }
  return out + escapeHtml(value.slice(last))
}

type Rendered = { tokens: string[]; text: string }

const PLACEHOLDER = (index: number) => `\u0000${index}\u0000`

const extract = (
  source: string,
  renderToken: (token: string, label?: string, href?: string) => string,
  escapeLiteral: (value: string) => string,
): Rendered => {
  const tokens: string[] = []
  let text = ''
  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    text += escapeLiteral(source.slice(last, match.index))
    tokens.push(renderToken(match[0], match[1], match[2]))
    text += PLACEHOLDER(tokens.length - 1)
    last = (match.index ?? 0) + match[0].length
  }
  text += escapeLiteral(source.slice(last))
  return { tokens, text }
}

const restore = ({ tokens, text }: Rendered) =>
  // oxlint-disable-next-line no-control-regex
  text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? '')

const BOLD = /\*\*(?=\S)([\s\S]*?\S)\*\*/g
const ITALIC = /(^|[\s(>])_(?=\S)([\s\S]*?\S)_(?=$|[\s).,!?:;<])/g

/** Inline markup → HTML for the template engine. */
export const inlineToHtml = (source: string, linkStyle = ''): string => {
  const rendered = extract(
    source,
    (token, label, href) => {
      if (label !== undefined && href !== undefined) {
        const target = safeHref(href)
        const inner = inlineToHtml(label, linkStyle)
        return target
          ? `<a href="${attr(target)}" target="_blank" rel="noopener"${linkStyle ? ` style="${linkStyle}"` : ''}>${inner}</a>`
          : inner
      }
      return isExpression(token) ? `{{ ${token.slice(2, -2).trim()} }}` : escapeHtml(token)
    },
    escapeHtml,
  )
  rendered.text = rendered.text
    .replace(BOLD, '<strong>$1</strong>')
    .replace(ITALIC, '$1<em>$2</em>')
    .replace(/\r?\n/g, '<br>')
  return restore(rendered)
}

/** Literal text for the plain-text body: braces are split so they do not open engine tags. */
const escapeText = (value: string) => value.replace(/\{\{/g, '{​{').replace(/\}\}/g, '}​}')

/** Inline markup → plain text for the template engine. */
export const inlineToText = (source: string): string => {
  const rendered = extract(
    source,
    (token, label, href) => {
      if (label !== undefined && href !== undefined) {
        const target = safeHref(href)
        const inner = inlineToText(label)
        return target && target !== inner ? `${inner} (${target})` : inner
      }
      return isExpression(token) ? `{{ ${token.slice(2, -2).trim()} }}` : escapeText(token)
    },
    escapeText,
  )
  rendered.text = rendered.text.replace(BOLD, '$1').replace(ITALIC, '$1$2')
  return restore(rendered)
}

/** `{{ expressions }}` used in inline markup (for variable checks and highlighting). */
export const inlineExpressions = (source: string): string[] =>
  [...source.matchAll(/\{\{[\s\S]*?\}\}/g)]
    .map((match) => match[0])
    .filter(isExpression)
    .map((token) => token.slice(2, -2).trim())
