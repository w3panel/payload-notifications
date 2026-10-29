import {
  ValidationError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
} from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { versionedCollectionDefaults } from '../compat'
import { changesRawHtml } from '../studio/save'
import { parseDesign, type EmailDesign } from '../studio/model'

/** Past versions kept on a partial (older ones are dropped). */
export const PARTIAL_HISTORY_LIMIT = 50

type HistoryEntry = { version: number; design: unknown; savedAt?: string }

/**
 * Saving a changed design bumps `version` and keeps the previous design in
 * `history`, so templates that pin a version keep rendering it.
 */
const versionPartial =
  (getOptions?: () => NormalizedNotificationsPluginOptions): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req, collection }) => {
    if (!data) return data
    const design = data.design ?? originalDoc?.design
    if (design !== undefined && design !== null) {
      const parsed = parseDesign(design)
      if (!parsed.ok) {
        throw new ValidationError({
          collection: collection?.slug,
          errors: parsed.errors.map((message) => ({ path: 'design', message })),
        })
      }
      if (
        getOptions &&
        req.user &&
        changesRawHtml(parsed.design, originalDoc?.design) &&
        !(await getOptions().access.rawHtml({ req }))
      ) {
        throw new ValidationError({
          collection: collection?.slug,
          errors: [
            {
              path: 'design',
              message: 'You do not have permission to add or change raw HTML blocks',
            },
          ],
        })
      }
    }
    if (!originalDoc) return { ...data, version: 1, history: [] }
    const changed =
      data.design !== undefined &&
      JSON.stringify(data.design) !== JSON.stringify(originalDoc.design)
    if (!changed) return data
    const current = typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const history = Array.isArray(originalDoc.history)
      ? (originalDoc.history as HistoryEntry[])
      : []
    return {
      ...data,
      version: current + 1,
      history: [
        { version: current, design: originalDoc.design, savedAt: new Date().toISOString() },
        ...history.map(({ version, design: past, savedAt }) => ({
          version,
          design: past,
          savedAt,
        })),
      ].slice(0, PARTIAL_HISTORY_LIMIT),
    }
  }

/** Reusable headers, footers and sections for visual email designs. */
export const NotificationTemplatePartialsCollection = ({
  slug = 'notification-template-partials',
  getOptions,
}: {
  slug?: string
  getOptions?: () => NormalizedNotificationsPluginOptions
} = {}): CollectionConfig => {
  const read: Access = ({ req }) => Boolean(req.user)
  const write: Access = ({ req }) => Boolean(req.user)
  return {
    slug,
    versions: false,
    ...versionedCollectionDefaults(),
    labels: { singular: 'Template Partial', plural: 'Template Partials' },
    access: { read, create: write, update: write, delete: write },
    admin: {
      useAsTitle: 'name',
      defaultColumns: ['name', 'kind', 'version', 'updatedAt'],
      group: 'Notifications',
      description:
        'Reusable headers, footers and sections for visual emails. Templates use the latest version unless they pin one; changes apply when a template is saved or published.',
    },
    fields: [
      { name: 'name', type: 'text', required: true },
      {
        name: 'kind',
        type: 'select',
        required: true,
        defaultValue: 'section',
        options: ['header', 'footer', 'section'],
        index: true,
      },
      { name: 'version', type: 'number', defaultValue: 1, admin: { readOnly: true } },
      { name: 'design', type: 'json', admin: { hidden: true } },
      {
        name: 'designer',
        type: 'ui',
        admin: {
          components: { Field: '@wtree/payload-notifications/admin#PartialDesignerField' },
          custom: { apiRoute: '/api', partialsSlug: slug },
        },
      },
      {
        name: 'history',
        type: 'array',
        admin: {
          readOnly: true,
          initCollapsed: true,
          description: 'Previous versions (newest first)',
        },
        fields: [
          { name: 'version', type: 'number', required: true },
          { name: 'design', type: 'json' },
          { name: 'savedAt', type: 'date' },
        ],
      },
    ],
    hooks: { beforeChange: [versionPartial(getOptions)] },
    timestamps: true,
  }
}

/** The design of a partial at a version (latest when `version` is empty). */
export const partialDesignAt = (
  doc: { version?: number; design?: unknown; history?: HistoryEntry[] | null },
  version?: number,
): EmailDesign | undefined => {
  const raw =
    !version || version === doc.version
      ? doc.design
      : doc.history?.find((entry) => entry.version === version)?.design
  const parsed = raw ? parseDesign(raw) : undefined
  return parsed?.ok ? parsed.design : undefined
}
