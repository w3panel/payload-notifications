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

/** Theme and partials for compiling a design on save. */
export const loadDesignResources: DesignResourceLoader = async ({ design, req, options }) => {
  const resources: DesignResources = {}
  const theme = await req.payload
    .findGlobal({ slug: options.globals.theme as never, depth: 1, overrideAccess: true, req })
    .catch(() => null)
  resources.theme = themeFromGlobal(theme as Record<string, unknown> | null)
  resources.partials = await loadPartials(req, options, design)
  return resources
}
