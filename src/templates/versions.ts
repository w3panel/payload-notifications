import type { Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { isObject } from '../data/paths'

/** Template document fields that make up its content (what a publish snapshots). */
export const TEMPLATE_CONTENT_FIELDS = [
  'channels',
  'email',
  'sms',
  'whatsapp',
  'inapp',
  'variables',
] as const

export type TemplateContent = Partial<Record<(typeof TEMPLATE_CONTENT_FIELDS)[number], unknown>>

const stripIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripIds)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'id')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stripIds(child)]),
  )
}

/** Content fields of a template document (array row IDs removed). */
export const contentOf = (doc: Record<string, unknown>): TemplateContent => {
  const content: TemplateContent = {}
  for (const field of TEMPLATE_CONTENT_FIELDS) {
    if (doc[field] !== undefined && doc[field] !== null) content[field] = stripIds(doc[field])
  }
  return content
}

export const sameContent = (a: TemplateContent, b: TemplateContent) =>
  JSON.stringify(stripIds(a)) === JSON.stringify(stripIds(b))

/** Locale lookup order: `hi-IN` → `hi` → default locale(s) → templates without a locale (''). */
export const localeCandidates = (locale?: string | null, defaultLocale?: string): string[] => {
  const expand = (value?: string | null) => {
    if (!value) return []
    const normalized = value.replace('_', '-').toLowerCase()
    const language = normalized.split('-')[0]
    return language === normalized ? [normalized] : [normalized, language]
  }
  return [...new Set([...expand(locale), ...expand(defaultLocale), ''])]
}

export const normalizeLocale = (locale: unknown): string =>
  typeof locale === 'string' ? locale.replace('_', '-').toLowerCase() : ''

export type TemplateSnapshot = {
  id: string | number
  template: string | number
  slug: string
  locale?: string
  version: number
  content: TemplateContent
}

/** The published snapshot of a template version, if one exists. */
export const loadTemplateSnapshot = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  templateId: string | number,
  version: number,
): Promise<TemplateSnapshot | undefined> => {
  const result = await payload.find({
    collection: options.collections.templateVersions as never,
    where: { and: [{ template: { equals: templateId } }, { version: { equals: version } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  return result.docs?.[0] as unknown as TemplateSnapshot | undefined
}

/** Writes an immutable snapshot of a template document's content as `version`. */
export const snapshotTemplate = async ({
  payload,
  options,
  doc,
  version,
  user,
  req,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  doc: Record<string, unknown> & { id: string | number }
  version: number
  user?: { id: string | number } | null
  req?: PayloadRequest
}) => {
  if (await loadTemplateSnapshot(payload, options, doc.id, version)) return
  await payload.create({
    collection: options.collections.templateVersions as never,
    overrideAccess: true,
    ...(req ? { req } : {}),
    data: {
      template: doc.id,
      slug: doc.slug,
      locale: normalizeLocale(doc.locale),
      version,
      content: contentOf(doc),
      publishedAt: new Date().toISOString(),
      ...(user ? { publishedBy: user.id } : {}),
    } as never,
  })
}
