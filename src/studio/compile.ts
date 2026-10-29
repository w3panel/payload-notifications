import { compile as compileEngineTemplate } from '../templates/engine'
import { attr, escapeHtml, inlineToHtml, inlineToText, safeHref } from './inline'
import type { Align, EmailBlock, EmailDesign, EmailDesignSettings, SocialNetwork } from './model'

/** Brand theme applied to visual designs; a design's own settings override it. */
export type EmailTheme = {
  logoUrl?: string
  logoAlt?: string
  logoWidth?: number
  colors?: {
    primary?: string
    buttonText?: string
    text?: string
    muted?: string
    link?: string
    background?: string
    contentBackground?: string
    border?: string
  }
  fontFamily?: string
  headingFontFamily?: string
  buttonRadius?: number
  /** Footer text used by footer blocks that have none (inline markup). */
  footerText?: string
}

export type CompileDesignOptions = {
  theme?: EmailTheme
  /** Partial blocks by `${partialId}` or `${partialId}@${version}`. */
  partials?: Record<string, EmailBlock[]>
  /** Absolute image URLs by media ID. */
  media?: Record<string, string>
  /** `lang` attribute of the document. */
  lang?: string
}

export type CompiledDesign = { html: string; text: string; warnings: string[] }

/** Comment that marks compiled visual designs (full documents that `emailLayout` must not wrap). */
export const VISUAL_DESIGN_MARKER = '<!-- payload-notifications:visual -->'

const DEFAULT_FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const HEADING_SIZES = { 1: 28, 2: 22, 3: 18 } as const
const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  x: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Website',
}

export type Style = {
  width: number
  font: string
  headingFont: string
  text: string
  muted: string
  link: string
  primary: string
  buttonText: string
  border: string
  background: string
  contentBackground: string
  buttonRadius: number
}

export const resolveStyle = (settings: EmailDesignSettings = {}, theme: EmailTheme = {}): Style => {
  const colors = theme.colors ?? {}
  const font = settings.fontFamily || theme.fontFamily || DEFAULT_FONT
  return {
    width: settings.width || 600,
    font,
    headingFont: theme.headingFontFamily || font,
    text: settings.textColor || colors.text || '#18181b',
    muted: colors.muted || '#71717a',
    link: settings.linkColor || colors.link || colors.primary || '#2563eb',
    primary: colors.primary || '#2563eb',
    buttonText: colors.buttonText || '#ffffff',
    border: colors.border || '#e4e4e7',
    background: settings.background || colors.background || '#f4f4f5',
    contentBackground: settings.contentBackground || colors.contentBackground || '#ffffff',
    buttonRadius: theme.buttonRadius ?? 6,
  }
}

/** Only plain colour values reach inline styles. */
const color = (value: string | undefined, fallback: string) =>
  value && /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i.test(value.trim())
    ? value.trim()
    : fallback

const font = (value: string) => value.replace(/["<>;{}]/g, '')
const align = (value: Align | undefined, fallback: Align = 'left'): Align =>
  value === 'center' || value === 'right' || value === 'left' ? value : fallback
const px = (value: number | undefined, fallback: number, max = 2000) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback

type Context = {
  style: Style
  options: CompileDesignOptions
  warnings: string[]
  /** Partial IDs being expanded (stops cycles). */
  partialStack: string[]
}

const row = (content: string, padding = '0 24px', cell: { align?: Align; style?: string } = {}) =>
  `<tr><td${cell.align ? ` align="${cell.align}"` : ''} style="padding:${padding}${cell.style ? `;${cell.style}` : ''}">${content}</td></tr>`

const blockRows = (blocks: EmailBlock[], ctx: Context, width: number): string =>
  blocks.map((block) => blockHtml(block, ctx, width)).join('')

const nestedTable = (rows: string, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse${style ? `;${style}` : ''}">${rows}</table>`

const partialBlocks = (partialId: string | number, version: number | undefined, ctx: Context) => {
  const key = version ? `${partialId}@${version}` : String(partialId)
  const blocks = ctx.options.partials?.[key] ?? ctx.options.partials?.[String(partialId)]
  if (!blocks) {
    ctx.warnings.push(`partial "${key}" was not found; it was left out`)
    return undefined
  }
  if (ctx.partialStack.includes(String(partialId))) {
    ctx.warnings.push(`partial "${partialId}" includes itself; it was left out`)
    return undefined
  }
  return blocks
}

const imageSrc = (block: Extract<EmailBlock, { type: 'image' }>, ctx: Context) => {
  if (block.mediaId !== undefined && block.mediaId !== '') {
    const url = ctx.options.media?.[String(block.mediaId)]
    if (url) return url
    ctx.warnings.push(`image "${block.alt || block.id}": media ${block.mediaId} has no URL`)
  }
  return block.src ?? ''
}

const blockHtml = (block: EmailBlock, ctx: Context, width: number): string => {
  const { style } = ctx
  const text = (size: number, textColor = style.text) =>
    `font-family:${font(style.font)};font-size:${size}px;line-height:1.5;color:${textColor}`
  const linkStyle = `color:${style.link};text-decoration:underline`

  switch (block.type) {
    case 'section': {
      const padding = px(block.padding, 24, 200)
      const inner = blockRows(block.children, ctx, width - padding * 2)
      const background = block.background ? `background-color:${color(block.background, '')}` : ''
      return `<tr><td${block.background ? ` bgcolor="${color(block.background, '')}"` : ''} style="padding:${padding}px 0;${background}">${nestedTable(inner)}</td></tr>`
    }
    case 'columns': {
      const given = block.columns.reduce((sum, column) => sum + (column.width ?? 0), 0)
      const unsized = block.columns.filter((column) => !column.width).length
      const share = unsized ? Math.max(0, 100 - given) / unsized : 0
      const widths = block.columns.map((column) => column.width ?? share)
      const columnPx = widths.map((percent) => Math.floor(((width - 48) * percent) / 100))
      if (block.stackOnMobile === false) {
        const cells = block.columns
          .map(
            (column, index) =>
              `<td width="${widths[index]}%" valign="top" style="vertical-align:top">${nestedTable(blockRows(column.children, ctx, columnPx[index]))}</td>`,
          )
          .join('')
        return row(nestedTable(`<tr>${cells}</tr>`))
      }
      // Fluid hybrid columns: inline-block divs that wrap on narrow screens, with an
      // Outlook-only table so desktop Outlook keeps them side by side.
      const msoCell = (index: number) => `<td width="${columnPx[index]}" valign="top">`
      const parts = block.columns.map((column, index) => {
        const inner = nestedTable(blockRows(column.children, ctx, columnPx[index]))
        const div = `<div class="pn-col" style="display:inline-block;width:100%;max-width:${columnPx[index]}px;vertical-align:top;font-size:16px">${inner}</div>`
        return index ? `<!--[if mso]></td>${msoCell(index)}<![endif]-->${div}` : div
      })
      // font-size:0 removes the gaps between inline-block columns.
      return row(
        `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${msoCell(0)}<![endif]-->${parts.join('')}<!--[if mso]></td></tr></table><![endif]-->`,
        '0 24px',
        { style: 'font-size:0;text-align:left' },
      )
    }
    case 'heading': {
      const level = block.level === 2 || block.level === 3 ? block.level : 1
      const size = HEADING_SIZES[level]
      return row(
        `<h${level} style="margin:0;font-family:${font(style.headingFont)};font-size:${size}px;line-height:1.25;font-weight:700;color:${color(block.color, style.text)};text-align:${align(block.align)}">${inlineToHtml(block.text, linkStyle)}</h${level}>`,
        '12px 24px',
      )
    }
    case 'text': {
      const size = px(block.fontSize, 16, 72)
      const paragraphs = block.text
        .split(/\n{2,}/)
        .map(
          (paragraph, index) =>
            `<p style="margin:${index ? '12px' : '0'} 0 0;${text(size, color(block.color, style.text))};text-align:${align(block.align)}">${inlineToHtml(paragraph, linkStyle)}</p>`,
        )
        .join('')
      return row(paragraphs, '8px 24px')
    }
    case 'image': {
      const src = imageSrc(block, ctx)
      if (!src) {
        ctx.warnings.push(`image "${block.alt || block.id}" has no source; it was left out`)
        return ''
      }
      const maxWidth = Math.max(1, width - 48)
      const imageWidth = Math.min(px(block.width, maxWidth), maxWidth)
      const img = `<img src="${attr(src)}" alt="${attr(block.alt ?? '')}" width="${imageWidth}" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;border:0;outline:none;text-decoration:none${align(block.align) === 'center' ? ';margin:0 auto' : ''}">`
      const href = block.href ? safeHref(block.href) : undefined
      return row(
        href ? `<a href="${attr(href)}" target="_blank" rel="noopener">${img}</a>` : img,
        '8px 24px',
        { align: align(block.align) },
      )
    }
    case 'button': {
      const href = safeHref(block.href) ?? '#'
      const background = color(block.background, style.primary)
      const radius = px(block.radius, style.buttonRadius, 50)
      const buttonAlign = align(block.align, 'center')
      const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${buttonAlign}" style="margin:0${buttonAlign === 'center' ? ' auto' : ''}"><tr><td align="center" bgcolor="${background}" style="border-radius:${radius}px;background-color:${background}"><a href="${attr(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-family:${font(style.font)};font-size:16px;font-weight:600;line-height:1.25;color:${color(block.color, style.buttonText)};text-decoration:none;border-radius:${radius}px">${inlineToHtml(block.label)}</a></td></tr></table>`
      return row(button, '12px 24px')
    }
    case 'divider':
      return row(
        nestedTable(
          `<tr><td style="border-top:${px(block.thickness, 1, 20)}px solid ${color(block.color, style.border)};font-size:0;line-height:0">&nbsp;</td></tr>`,
        ),
        '12px 24px',
      )
    case 'spacer':
      return `<tr><td style="height:${px(block.height, 24, 400)}px;font-size:0;line-height:0">&nbsp;</td></tr>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const items = block.items
        .map((item) => `<li style="margin:0 0 4px">${inlineToHtml(item, linkStyle)}</li>`)
        .join('')
      return row(
        `<${tag} style="margin:0;padding:0 0 0 24px;${text(16)}">${items}</${tag}>`,
        '8px 24px',
      )
    }
    case 'social': {
      const links = block.links
        .map((link) => {
          const href = safeHref(link.url)
          return href
            ? `<a href="${attr(href)}" target="_blank" rel="noopener" style="${linkStyle}">${SOCIAL_LABELS[link.network] ?? escapeHtml(link.network)}</a>`
            : ''
        })
        .filter(Boolean)
        .join(' &nbsp;·&nbsp; ')
      return row(
        `<p style="margin:0;${text(14)};text-align:${align(block.align, 'center')}">${links}</p>`,
        '8px 24px',
      )
    }
    case 'footer': {
      const footerText = block.text || ctx.options.theme?.footerText || ''
      const mutedLink = `color:${style.muted};text-decoration:underline`
      const unsubscribe = block.includeUnsubscribe
        ? `{{#if unsubscribeUrl}}<br><a href="{{ unsubscribeUrl }}" target="_blank" rel="noopener" style="${mutedLink}">Unsubscribe</a>{{/if}}`
        : ''
      return row(
        `<p style="margin:0;${text(12, style.muted)};text-align:${align(block.align, 'center')}">${inlineToHtml(footerText, mutedLink)}${unsubscribe}</p>`,
        '16px 24px',
      )
    }
    case 'loop': {
      const rows = blockRows(block.children, ctx, width)
      const empty = block.emptyText
        ? `{{else}}${row(`<p style="margin:0;${text(14, style.muted)}">${inlineToHtml(block.emptyText, linkStyle)}</p>`, '8px 24px')}`
        : ''
      return `{{#if ${block.path}}}{{#each ${block.path}}}${rows}{{/each}}${empty}{{/if}}`
    }
    case 'conditional': {
      const body = blockRows(block.children, ctx, width)
      const elseBody = block.elseChildren?.length
        ? `{{else}}${blockRows(block.elseChildren, ctx, width)}`
        : ''
      return `{{#if ${block.path}}}${body}${elseBody}{{/if}}`
    }
    case 'html':
      return block.html ? row(block.html, '8px 24px') : ''
    case 'partial': {
      const blocks = partialBlocks(block.partialId, block.version, ctx)
      if (!blocks) return ''
      return blockRows(
        blocks,
        { ...ctx, partialStack: [...ctx.partialStack, String(block.partialId)] },
        width,
      )
    }
  }
}

const blockText = (block: EmailBlock, ctx: Context): string => {
  const join = (blocks: EmailBlock[], next = ctx) =>
    blocks
      .map((child) => blockText(child, next))
      .filter(Boolean)
      .join('\n\n')
  switch (block.type) {
    case 'section':
      return join(block.children)
    case 'columns':
      return block.columns
        .map((column) => join(column.children))
        .filter(Boolean)
        .join('\n\n')
    case 'heading':
      return inlineToText(block.text)
    case 'text':
      return inlineToText(block.text)
    case 'image':
      return ''
    case 'button': {
      const href = safeHref(block.href)
      return href ? `${inlineToText(block.label)}: ${href}` : inlineToText(block.label)
    }
    case 'divider':
      return '----------'
    case 'spacer':
      return ''
    case 'list':
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlineToText(item)}`)
        .join('\n')
    case 'social':
      return block.links
        .filter((link) => safeHref(link.url))
        .map((link) => `${SOCIAL_LABELS[link.network] ?? link.network}: ${link.url}`)
        .join('\n')
    case 'footer': {
      const footerText = inlineToText(block.text || ctx.options.theme?.footerText || '')
      const unsubscribe = block.includeUnsubscribe
        ? `{{#if unsubscribeUrl}}\nUnsubscribe: {{ unsubscribeUrl }}{{/if}}`
        : ''
      return `${footerText}${unsubscribe}`.trim()
    }
    case 'loop': {
      const empty = block.emptyText ? `{{else}}${inlineToText(block.emptyText)}` : ''
      return `{{#if ${block.path}}}{{#each ${block.path}}}${join(block.children)}\n{{/each}}${empty}{{/if}}`
    }
    case 'conditional': {
      const elseBody = block.elseChildren?.length ? `{{else}}${join(block.elseChildren)}` : ''
      return `{{#if ${block.path}}}${join(block.children)}${elseBody}{{/if}}`
    }
    case 'html':
      return block.html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim()
    case 'partial': {
      const blocks = partialBlocks(block.partialId, block.version, { ...ctx, warnings: [] })
      return blocks
        ? join(blocks, { ...ctx, partialStack: [...ctx.partialStack, String(block.partialId)] })
        : ''
    }
  }
}

/** Media queries for clients that support them (others get the fluid layout). */
const responsiveCss = (style: Style) =>
  [
    `@media only screen and (max-width:${style.width + 20}px){`,
    '.pn-container{width:100%!important}',
    '.pn-col{max-width:100%!important;display:block!important}',
    '}',
    ':root{color-scheme:light dark;supported-color-schemes:light dark}',
  ].join('')

/**
 * Compiles a design into table-based HTML with inline styles and a plain-text
 * body. Both are template engine sources: variables, loops and conditions are
 * resolved when the notification is rendered.
 */
export const compileDesign = (
  design: EmailDesign,
  options: CompileDesignOptions = {},
): CompiledDesign => {
  const style = resolveStyle(design.settings, options.theme)
  const ctx: Context = { style, options, warnings: [], partialStack: [] }
  const theme = options.theme
  const logo = theme?.logoUrl
    ? row(
        `<img src="${attr(theme.logoUrl)}" alt="${attr(theme.logoAlt || 'Logo')}" width="${px(theme.logoWidth, 120, 600)}" style="display:block;height:auto;border:0;outline:none;text-decoration:none">`,
        '24px 24px 8px',
      )
    : ''
  const body = blockRows(design.blocks, ctx, style.width)

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${attr(options.lang || 'en')}" xmlns="http://www.w3.org/1999/xhtml">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<style>${responsiveCss(style)}</style>`,
    `<!--[if mso]><style>table,td,h1,h2,h3,p,a{font-family:Arial,sans-serif!important}</style><![endif]-->`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${style.background};-webkit-text-size-adjust:100%">`,
    VISUAL_DESIGN_MARKER,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${style.background}" style="background-color:${style.background}"><tr><td align="center" style="padding:24px 12px">`,
    `<!--[if mso]><table role="presentation" width="${style.width}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    `<table role="presentation" class="pn-container" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${style.contentBackground}" style="width:100%;max-width:${style.width}px;background-color:${style.contentBackground};border-collapse:collapse">`,
    logo,
    body,
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table>',
    '</body></html>',
  ].join('')

  const text = design.blocks
    .map((block) => blockText(block, ctx))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Both outputs must parse in the engine (unbalanced blocks would fail every send).
  for (const [name, source] of [
    ['html', html],
    ['text', text],
  ] as const) {
    try {
      compileEngineTemplate(source)
    } catch (error) {
      ctx.warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { html, text, warnings: [...new Set(ctx.warnings)] }
}
