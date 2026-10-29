/**
 * Block document model for the visual email designer, stored in a template's
 * `email.design`. The compiler (`./compile`) turns it into `htmlBody` / `textBody`
 * on save, so sending, versioning and code mode keep working on HTML.
 *
 * Text fields use a small inline markup: `**bold**`, `_italic_`,
 * `[label](https://url)` and `{{ path }}` variables.
 */

/** Current design schema version. Bump it and add a migration when the shape changes. */
export const DESIGN_VERSION = 1

export type Align = 'left' | 'center' | 'right'

type BlockBase = { id: string }

export type SectionBlock = BlockBase & {
  type: 'section'
  background?: string
  padding?: number
  children: EmailBlock[]
}
export type ColumnsBlock = BlockBase & {
  type: 'columns'
  /** Column widths are percentages; missing widths share the rest equally. */
  columns: Array<{ width?: number; children: EmailBlock[] }>
  /** Stack columns on narrow screens (default true). */
  stackOnMobile?: boolean
}
export type HeadingBlock = BlockBase & {
  type: 'heading'
  text: string
  level?: 1 | 2 | 3
  align?: Align
  color?: string
}
export type TextBlock = BlockBase & {
  type: 'text'
  text: string
  align?: Align
  color?: string
  fontSize?: number
}
export type ImageBlock = BlockBase & {
  type: 'image'
  /** ID in `templates.mediaCollection`; resolved to an absolute URL on save. */
  mediaId?: string | number
  /** Absolute image URL (used when there is no `mediaId`). */
  src?: string
  alt: string
  width?: number
  href?: string
  align?: Align
}
export type ButtonBlock = BlockBase & {
  type: 'button'
  label: string
  href: string
  align?: Align
  background?: string
  color?: string
  radius?: number
}
export type DividerBlock = BlockBase & { type: 'divider'; color?: string; thickness?: number }
export type SpacerBlock = BlockBase & { type: 'spacer'; height: number }
export type ListBlock = BlockBase & { type: 'list'; items: string[]; ordered?: boolean }
export const SOCIAL_NETWORKS = [
  'facebook',
  'x',
  'instagram',
  'linkedin',
  'youtube',
  'tiktok',
  'whatsapp',
  'website',
] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]
export type SocialBlock = BlockBase & {
  type: 'social'
  links: Array<{ network: SocialNetwork; url: string }>
  align?: Align
}
export type FooterBlock = BlockBase & {
  type: 'footer'
  text: string
  /** Adds an unsubscribe link (`{{ unsubscribeUrl }}`). */
  includeUnsubscribe?: boolean
  align?: Align
}
/** Repeats its children for each item of a list (`{{#each path}}`), e.g. order line items. */
export type LoopBlock = BlockBase & {
  type: 'loop'
  path: string
  children: EmailBlock[]
  /** Shown when the list is empty. */
  emptyText?: string
}
/** Shows its children only when a value is truthy (`{{#if path}}`). */
export type ConditionalBlock = BlockBase & {
  type: 'conditional'
  path: string
  children: EmailBlock[]
  elseChildren?: EmailBlock[]
}
/** Raw HTML, inserted as-is. Saving one requires the `access.rawHtml` permission. */
export type HtmlBlock = BlockBase & { type: 'html'; html: string }
/** A reusable section from `notification-template-partials`. */
export type PartialBlock = BlockBase & {
  type: 'partial'
  partialId: string | number
  /** Pin a partial version; empty uses the partial's current version. */
  version?: number
}

export type EmailBlock =
  | SectionBlock
  | ColumnsBlock
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | ListBlock
  | SocialBlock
  | FooterBlock
  | LoopBlock
  | ConditionalBlock
  | HtmlBlock
  | PartialBlock

export type EmailBlockType = EmailBlock['type']

export type EmailDesignSettings = {
  /** Content width in px (default 600). */
  width?: number
  background?: string
  contentBackground?: string
  fontFamily?: string
  textColor?: string
  linkColor?: string
}

export type EmailDesign = {
  version: number
  settings?: EmailDesignSettings
  blocks: EmailBlock[]
}

export const BLOCK_TYPES: EmailBlockType[] = [
  'section',
  'columns',
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'list',
  'social',
  'footer',
  'loop',
  'conditional',
  'html',
  'partial',
]

/** Blocks that hold other blocks. */
export const CONTAINER_TYPES = new Set<EmailBlockType>(['section', 'loop', 'conditional'])

let idCounter = 0
/** Short unique block ID. */
export const newBlockId = (): string => {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  idCounter = (idCounter + 1) % 1_000_000
  return `b_${random}${idCounter.toString(36)}`
}

/** A new block with sensible defaults (used by the editor palette). */
export const createBlock = (type: EmailBlockType): EmailBlock => {
  const id = newBlockId()
  switch (type) {
    case 'section':
      return { id, type, padding: 24, children: [] }
    case 'columns':
      return { id, type, columns: [{ children: [] }, { children: [] }], stackOnMobile: true }
    case 'heading':
      return { id, type, text: 'Heading', level: 1 }
    case 'text':
      return { id, type, text: 'Write something…' }
    case 'image':
      return { id, type, src: '', alt: '' }
    case 'button':
      return { id, type, label: 'Open', href: 'https://' }
    case 'divider':
      return { id, type }
    case 'spacer':
      return { id, type, height: 24 }
    case 'list':
      return { id, type, items: ['First item'] }
    case 'social':
      return { id, type, links: [{ network: 'website', url: 'https://' }], align: 'center' }
    case 'footer':
      return { id, type, text: '', includeUnsubscribe: true, align: 'center' }
    case 'loop':
      return { id, type, path: 'payload.items', children: [] }
    case 'conditional':
      return { id, type, path: 'payload.', children: [] }
    case 'html':
      return { id, type, html: '' }
    case 'partial':
      return { id, type, partialId: '' }
  }
}

export const emptyDesign = (): EmailDesign => ({
  version: DESIGN_VERSION,
  settings: {},
  blocks: [],
})

/** Child lists of a block (columns contribute one list per column). */
export const childLists = (block: EmailBlock): EmailBlock[][] => {
  switch (block.type) {
    case 'section':
    case 'loop':
      return [block.children]
    case 'conditional':
      return [block.children, block.elseChildren ?? []]
    case 'columns':
      return block.columns.map((column) => column.children)
    default:
      return []
  }
}

/** Depth-first walk over every block. */
export const walkBlocks = (
  blocks: EmailBlock[],
  visit: (block: EmailBlock, parents: EmailBlock[]) => void,
  parents: EmailBlock[] = [],
): void => {
  for (const block of blocks) {
    visit(block, parents)
    for (const list of childLists(block)) walkBlocks(list, visit, [...parents, block])
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Migrations from version N to N + 1. Version 0 is the pre-release shape:
 * blocks without IDs, `children` called `blocks`, and settings at the root.
 */
export const DESIGN_MIGRATIONS: Record<
  number,
  (design: Record<string, unknown>) => Record<string, unknown>
> = {
  0: (design) => {
    const upgrade = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(upgrade)
      if (!isObject(value)) return value
      const next: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(value)) {
        next[key === 'blocks' && 'type' in value ? 'children' : key] = upgrade(child)
      }
      if ('type' in next && typeof next.id !== 'string') next.id = newBlockId()
      return next
    }
    const { blocks, width, background, fontFamily, ...rest } = design
    return {
      ...rest,
      version: 1,
      settings: {
        ...(isObject(design.settings) ? design.settings : {}),
        ...(width !== undefined ? { width } : {}),
        ...(background !== undefined ? { background } : {}),
        ...(fontFamily !== undefined ? { fontFamily } : {}),
      },
      blocks: upgrade(blocks ?? []),
    }
  },
}

/** Upgrades a stored design to `DESIGN_VERSION`. */
export const migrateDesign = (raw: Record<string, unknown>): Record<string, unknown> => {
  let design = raw
  let version = typeof design.version === 'number' ? design.version : 0
  while (version < DESIGN_VERSION) {
    const migrate = DESIGN_MIGRATIONS[version]
    if (!migrate) throw new Error(`No email design migration from version ${version}`)
    design = migrate(design)
    version = typeof design.version === 'number' ? design.version : version + 1
  }
  return design
}

/** A variable path such as `payload.items` or `order.total`. */
const PATH_PATTERN = /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/

const validateBlock = (block: unknown, where: string, errors: string[], inLoop: boolean) => {
  if (!isObject(block)) {
    errors.push(`${where}: block must be an object`)
    return
  }
  const type = block.type as EmailBlockType
  const at = `${where} (${String(type)})`
  if (!BLOCK_TYPES.includes(type)) {
    errors.push(`${where}: unknown block type "${String(block.type)}"`)
    return
  }
  if (typeof block.id !== 'string' || !block.id) errors.push(`${at}: id is required`)

  const children = (key: string, list: unknown, loop = inLoop) => {
    if (!Array.isArray(list)) {
      errors.push(`${at}: ${key} must be a list`)
      return
    }
    list.forEach((child, index) => validateBlock(child, `${where}.${key}[${index}]`, errors, loop))
  }

  switch (type) {
    case 'section':
      children('children', block.children)
      break
    case 'columns':
      if (!Array.isArray(block.columns) || block.columns.length < 1 || block.columns.length > 4) {
        errors.push(`${at}: needs 1 to 4 columns`)
        break
      }
      block.columns.forEach((column, index) =>
        children(`columns[${index}].children`, isObject(column) ? column.children : undefined),
      )
      break
    case 'heading':
    case 'text':
      if (typeof block.text !== 'string') errors.push(`${at}: text is required`)
      break
    case 'image':
      if (typeof block.alt !== 'string' || !block.alt.trim()) {
        errors.push(`${at}: alt text is required`)
      }
      if (!block.mediaId && !(typeof block.src === 'string' && block.src)) {
        errors.push(`${at}: choose an image or enter its URL`)
      }
      break
    case 'button':
      if (typeof block.label !== 'string' || !block.label.trim())
        errors.push(`${at}: label is required`)
      if (typeof block.href !== 'string' || !block.href.trim())
        errors.push(`${at}: link is required`)
      break
    case 'spacer':
      if (typeof block.height !== 'number' || block.height < 0)
        errors.push(`${at}: height must be a number`)
      break
    case 'list':
      if (!Array.isArray(block.items)) errors.push(`${at}: items must be a list`)
      break
    case 'social':
      if (!Array.isArray(block.links)) errors.push(`${at}: links must be a list`)
      else
        for (const link of block.links) {
          if (!isObject(link) || !SOCIAL_NETWORKS.includes(link.network as SocialNetwork)) {
            errors.push(`${at}: unknown social network`)
          }
        }
      break
    case 'loop':
    case 'conditional': {
      const path = typeof block.path === 'string' ? block.path.trim() : ''
      // Inside a loop, paths may be relative to the item (`name`, `this.price`).
      if (!PATH_PATTERN.test(path)) errors.push(`${at}: "${path}" is not a variable path`)
      children('children', block.children, inLoop || type === 'loop')
      if (type === 'conditional' && block.elseChildren !== undefined) {
        children('elseChildren', block.elseChildren)
      }
      break
    }
    case 'html':
      if (typeof block.html !== 'string') errors.push(`${at}: html must be text`)
      break
    case 'partial':
      if (block.partialId === undefined || block.partialId === '') {
        errors.push(`${at}: choose a partial`)
      }
      break
  }
}

export type DesignParseResult = { ok: true; design: EmailDesign } | { ok: false; errors: string[] }

/** Migrates and validates a stored design. Known and unknown fields are kept as they are. */
export const parseDesign = (raw: unknown): DesignParseResult => {
  if (!isObject(raw)) return { ok: false, errors: ['design must be an object'] }
  let migrated: Record<string, unknown>
  try {
    migrated = migrateDesign(raw)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }
  }
  const errors: string[] = []
  if (migrated.version !== DESIGN_VERSION) {
    errors.push(`design version ${String(migrated.version)} is newer than this plugin supports`)
  }
  if (!Array.isArray(migrated.blocks)) errors.push('design.blocks must be a list')
  else
    migrated.blocks.forEach((block, index) =>
      validateBlock(block, `blocks[${index}]`, errors, false),
    )

  const ids = new Set<string>()
  if (!errors.length) {
    walkBlocks(migrated.blocks as EmailBlock[], (block) => {
      if (ids.has(block.id)) errors.push(`duplicate block id "${block.id}"`)
      ids.add(block.id)
    })
  }
  return errors.length ? { ok: false, errors } : { ok: true, design: migrated as EmailDesign }
}
