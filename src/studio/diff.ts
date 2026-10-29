/** Line diff and template content comparison for version history. */

export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string }

/** Above this many line pairs the diff falls back to "all removed / all added". */
const MAX_CELLS = 4_000_000

/** Line-based diff (longest common subsequence). */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'removed' as const, text })),
      ...b.map((text) => ({ type: 'added' as const, text })),
    ]
  }
  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ type: 'removed', text: a[i++] })
    } else {
      lines.push({ type: 'added', text: b[j++] })
    }
  }
  while (i < a.length) lines.push({ type: 'removed', text: a[i++] })
  while (j < b.length) lines.push({ type: 'added', text: b[j++] })
  return lines
}

/** Puts each tag on its own line so compiled (single-line) HTML diffs usefully. */
export const formatHtmlForDiff = (html: string): string =>
  html
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

/** Compared template fields: [label, path]. */
export const DIFF_FIELDS: Array<[string, string]> = [
  ['Channels', 'channels'],
  ['Email subject', 'email.subject'],
  ['Email preheader', 'email.preheader'],
  ['Email HTML', 'email.htmlBody'],
  ['Email text', 'email.textBody'],
  ['SMS', 'sms.body'],
  ['WhatsApp text', 'whatsapp.body'],
  ['WhatsApp template', 'whatsapp.hsmTemplateId'],
  ['WhatsApp language', 'whatsapp.hsmLanguage'],
  ['WhatsApp parameters', 'whatsapp.hsmParameters'],
  ['In-app title', 'inapp.title'],
  ['In-app body', 'inapp.body'],
  ['In-app link', 'inapp.actionUrl'],
  ['In-app icon', 'inapp.icon'],
  ['In-app priority', 'inapp.priority'],
]

const read = (doc: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      doc,
    )

const asText = (value: unknown, path: string): string => {
  if (value === null || value === undefined) return ''
  if (path === 'email.htmlBody' && typeof value === 'string') return formatHtmlForDiff(value)
  if (path === 'whatsapp.hsmParameters' && Array.isArray(value)) {
    return value
      .map(
        (entry, index) =>
          `{{${index + 1}}} ${String((entry as { value?: unknown })?.value ?? entry)}`,
      )
      .join('\n')
  }
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export type FieldDiff = { label: string; path: string; lines: DiffLine[] }

/** Changed fields between two template contents (version snapshots or form values). */
export const diffTemplateContent = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldDiff[] =>
  DIFF_FIELDS.flatMap(([label, path]) => {
    const a = asText(read(before, path), path)
    const b = asText(read(after, path), path)
    return a === b ? [] : [{ label, path, lines: diffLines(a, b) }]
  })

/** Context lines kept around changes when showing a diff. */
export const collapseDiff = (
  lines: DiffLine[],
  context = 2,
): Array<DiffLine | { type: 'gap'; count: number }> => {
  const keep = lines.map((line) => line.type !== 'same')
  const visible = lines.map((_, index) =>
    keep.slice(Math.max(0, index - context), index + context + 1).some(Boolean),
  )
  const out: Array<DiffLine | { type: 'gap'; count: number }> = []
  let gap = 0
  lines.forEach((line, index) => {
    if (visible[index]) {
      if (gap) out.push({ type: 'gap', count: gap })
      gap = 0
      out.push(line)
    } else gap++
  })
  if (gap) out.push({ type: 'gap', count: gap })
  return out
}
