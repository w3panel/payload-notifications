import { ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { compileDesign, type CompileDesignOptions } from './compile'
import { parseDesign, walkBlocks, type EmailBlock, type EmailDesign } from './model'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Raw HTML blocks by ID. */
const rawHtmlBlocks = (design: unknown): Map<string, string> => {
  const blocks = new Map<string, string>()
  if (!isObject(design) || !Array.isArray(design.blocks)) return blocks
  walkBlocks(design.blocks as EmailBlock[], (block) => {
    if (block.type === 'html') blocks.set(block.id, block.html ?? '')
  })
  return blocks
}

/** True when `next` adds a raw HTML block or changes one that `previous` had. */
export const changesRawHtml = (next: unknown, previous: unknown): boolean => {
  const before = rawHtmlBlocks(previous)
  for (const [id, html] of rawHtmlBlocks(next)) {
    if (before.get(id) !== html) return true
  }
  return false
}

export type DesignResources = Pick<CompileDesignOptions, 'theme' | 'partials' | 'media'>

/** Loads what a design references (theme, partials, media). Extended by the theme and media features. */
export type DesignResourceLoader = (args: {
  design: EmailDesign
  req: PayloadRequest
  options: NormalizedNotificationsPluginOptions
}) => Promise<DesignResources>

const noResources: DesignResourceLoader = async () => ({})

/**
 * `beforeChange` for templates: when the email editor is `visual`, compiles
 * `email.design` into `email.htmlBody` / `email.textBody`. Adding or changing a
 * raw HTML block needs `access.rawHtml`.
 */
export const compileVisualEmail =
  (
    getOptions: (() => NormalizedNotificationsPluginOptions) | undefined,
    loadResources: DesignResourceLoader = noResources,
  ): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req, collection }) => {
    if (!data || !isObject(data.email)) return data
    const email = data.email
    const editor =
      email.editor ?? (isObject(originalDoc?.email) ? originalDoc.email.editor : undefined)
    if (editor !== 'visual' || email.design === undefined || email.design === null) return data
    if (!getOptions) return data
    const options = getOptions()

    const parsed = parseDesign(email.design)
    if (!parsed.ok) {
      throw new ValidationError({
        collection: collection?.slug,
        errors: parsed.errors.map((message) => ({ path: 'email.design', message })),
      })
    }

    const previousDesign = isObject(originalDoc?.email) ? originalDoc.email.design : undefined
    if (changesRawHtml(parsed.design, previousDesign) && !(await options.access.rawHtml({ req }))) {
      throw new ValidationError({
        collection: collection?.slug,
        errors: [
          {
            path: 'email.design',
            message: 'You do not have permission to add or change raw HTML blocks',
          },
        ],
      })
    }

    const resources = await loadResources({ design: parsed.design, req, options })
    const locale = data.locale ?? originalDoc?.locale
    const compiled = compileDesign(parsed.design, {
      ...resources,
      ...(typeof locale === 'string' && locale ? { lang: locale } : {}),
    })
    return {
      ...data,
      email: { ...email, design: parsed.design, htmlBody: compiled.html, textBody: compiled.text },
    }
  }
