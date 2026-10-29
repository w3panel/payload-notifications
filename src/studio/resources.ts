import type { PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { partialDesignAt } from '../collections/NotificationTemplatePartials'
import type { EmailTheme } from './compile'
import { walkBlocks, type EmailBlock, type EmailDesign } from './model'
import type { DesignResourceLoader, DesignResources } from './save'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Drops empty values so theme defaults apply. */
const compact = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== null && entry !== undefined && entry !== '',
    ),
  ) as Partial<T>

/** The theme global as compiler options. */
export const themeFromGlobal = (doc: Record<string, unknown> | null | undefined): EmailTheme => {
  if (!doc) return {}
  const colors = isObject(doc.colors) ? compact(doc.colors) : {}
  return compact({
    logoUrl: doc.logoUrl,
    logoAlt: doc.logoAlt,
    logoWidth: doc.logoWidth,
    fontFamily: doc.fontFamily,
    headingFontFamily: doc.headingFontFamily,
    buttonRadius: doc.buttonRadius,
    footerText: doc.footerText,
    ...(Object.keys(colors).length ? { colors } : {}),
  }) as EmailTheme
}

/** Partial references (`id` or `id@version`) in blocks. */
const partialRefs = (blocks: EmailBlock[]) => {
  const refs: Array<{ id: string | number; version?: number }> = []
  walkBlocks(blocks, (block) => {
    if (block.type === 'partial' && block.partialId !== '') {
      refs.push({ id: block.partialId, version: block.version || undefined })
    }
  })
  return refs
}

/** Nested partials are followed this many levels deep. */
const MAX_PARTIAL_DEPTH = 5

/** Loads partials a design references, including partials inside partials. */
export const loadPartials = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  design: EmailDesign,
): Promise<Record<string, EmailBlock[]>> => {
  const partials: Record<string, EmailBlock[]> = {}
  const docs = new Map<string, Record<string, unknown> | null>()
  let pending = partialRefs(design.blocks)
  for (let depth = 0; depth < MAX_PARTIAL_DEPTH && pending.length; depth++) {
    const next: typeof pending = []
    for (const ref of pending) {
      const key = ref.version ? `${ref.id}@${ref.version}` : String(ref.id)
      if (key in partials) continue
      if (!docs.has(String(ref.id))) {
        const doc = await req.payload
          .findByID({
            collection: options.collections.partials as never,
            id: ref.id,
            depth: 0,
            overrideAccess: true,
            req,
          })
          .catch(() => null)
        docs.set(String(ref.id), doc as Record<string, unknown> | null)
      }
      const doc = docs.get(String(ref.id))
      const partialDesign = doc ? partialDesignAt(doc as never, ref.version) : undefined
      if (!partialDesign) continue
      partials[key] = partialDesign.blocks
      next.push(...partialRefs(partialDesign.blocks))
    }
    pending = next
  }
  return partials
}

/** Makes a media URL absolute (`/api/media/file/a.png` → `https://site/api/media/file/a.png`). */
export const absoluteUrl = (url: unknown, base?: string): string | undefined => {
  if (typeof url !== 'string' || !url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/') && base && /^https?:\/\//i.test(base))
    return `${base.replace(/\/$/, '')}${url}`
  return undefined
}

const mediaBase = (req: PayloadRequest, options: NormalizedNotificationsPluginOptions) =>
  options.templates.mediaBaseUrl || req.payload.config?.serverURL || undefined

/** Absolute URLs of media used by image blocks (in the design and its partials). */
export const loadMedia = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  blockLists: EmailBlock[][],
): Promise<Record<string, string>> => {
  const collection = options.templates.mediaCollection
  if (!collection) return {}
  const ids = new Set<string>()
  for (const blocks of blockLists) {
    walkBlocks(blocks, (block) => {
      if (block.type === 'image' && block.mediaId !== undefined && block.mediaId !== '') {
        ids.add(String(block.mediaId))
      }
    })
  }
  const media: Record<string, string> = {}
  for (const id of ids) {
    const doc = (await req.payload
      .findByID({ collection: collection as never, id, depth: 0, overrideAccess: true, req })
      .catch(() => null)) as Record<string, unknown> | null
    const url = absoluteUrl(doc?.url, mediaBase(req, options))
    if (url) media[id] = url
  }
  return media
}

/** Theme, partials and media for compiling a design on save. */
export const loadDesignResources: DesignResourceLoader = async ({ design, req, options }) => {
  const resources: DesignResources = {}
  const global = (await req.payload
    .findGlobal({ slug: options.globals.theme as never, depth: 1, overrideAccess: true, req })
    .catch(() => null)) as Record<string, unknown> | null
  resources.theme = themeFromGlobal(global)
  // An uploaded logo wins over the logo URL.
  const logo = isObject(global?.logo)
    ? absoluteUrl(global.logo.url, mediaBase(req, options))
    : undefined
  if (logo) resources.theme.logoUrl = logo
  resources.partials = await loadPartials(req, options, design)
  resources.media = await loadMedia(req, options, [
    design.blocks,
    ...Object.values(resources.partials),
  ])
  return resources
}
