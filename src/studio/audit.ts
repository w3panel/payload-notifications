import { resolveStyle, type EmailTheme } from './compile'
import { walkBlocks, type EmailDesign } from './model'

export type EmailCheck = { level: 'error' | 'warning'; message: string; blockId?: string }

/** Gmail clips messages larger than this (bytes of HTML). */
export const GMAIL_CLIP_BYTES = 102 * 1024

const GENERIC_LINK_TEXT = new Set([
  'click here',
  'here',
  'click',
  'link',
  'this link',
  'read more',
  'more',
  'learn more',
])

const parseHex = (value: string | undefined): [number, number, number] | undefined => {
  const hex = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!hex) return undefined
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio of two hex colours, or undefined when either is not hex. */
export const contrastRatio = (a: string | undefined, b: string | undefined): number | undefined => {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return undefined
  const [light, dark] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (light + 0.05) / (dark + 0.05)
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Checks rendered email HTML (and the design it came from) for accessibility and size issues. */
export const auditEmail = ({
  html,
  design,
  theme,
}: {
  html: string
  design?: EmailDesign
  theme?: EmailTheme
}): EmailCheck[] => {
  const checks: EmailCheck[] = []

  const bytes = new TextEncoder().encode(html).length
  if (bytes > GMAIL_CLIP_BYTES) {
    checks.push({
      level: 'warning',
      message: `The email is ${Math.round(bytes / 1024)} KB; Gmail clips messages over 102 KB`,
    })
  }

  const missingAlt = (html.match(/<img\b[^>]*>/gi) ?? []).filter(
    (tag) => !/\balt\s*=\s*"[^"]*\S[^"]*"/i.test(tag),
  ).length
  if (missingAlt) {
    checks.push({ level: 'error', message: `${missingAlt} image(s) have no alt text` })
  }

  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const inner = match[1]
    const text = textOf(inner).toLowerCase()
    const imageAlt = /<img\b[^>]*\balt\s*=\s*"([^"]*\S[^"]*)"/i.exec(inner)?.[1]
    if (!text && !imageAlt) {
      checks.push({ level: 'error', message: 'A link has no text' })
    } else if (GENERIC_LINK_TEXT.has(text.replace(/[.!…]+$/, ''))) {
      checks.push({
        level: 'warning',
        message: `Link text "${textOf(inner)}" does not say where it goes`,
      })
    }
  }

  if (design) {
    const style = resolveStyle(design.settings, theme)
    const check = (
      fg: string | undefined,
      bg: string | undefined,
      what: string,
      blockId?: string,
      large = false,
    ) => {
      const ratio = contrastRatio(fg, bg)
      const minimum = large ? 3 : 4.5
      if (ratio !== undefined && ratio < minimum) {
        checks.push({
          level: 'warning',
          blockId,
          message: `${what}: contrast ${ratio.toFixed(1)}:1 is below ${minimum}:1`,
        })
      }
    }
    check(style.text, style.contentBackground, 'Body text')
    check(style.link, style.contentBackground, 'Links')
    walkBlocks(design.blocks, (block, parents) => {
      const section = [...parents].reverse().find((parent) => parent.type === 'section')
      const background =
        (section?.type === 'section' && section.background) || style.contentBackground
      if (block.type === 'button') {
        check(
          block.color || style.buttonText,
          block.background || style.primary,
          `Button "${block.label}"`,
          block.id,
          true,
        )
      } else if (block.type === 'heading') {
        check(block.color || style.text, background, 'Heading', block.id, true)
      } else if (block.type === 'text' && (block.color || section)) {
        check(block.color || style.text, background, 'Text', block.id, (block.fontSize ?? 16) >= 24)
      }
    })
  }

  // Duplicates (e.g. several generic links) are reported once.
  const seen = new Set<string>()
  return checks.filter((entry) => {
    const key = `${entry.level}:${entry.blockId ?? ''}:${entry.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
