import {
  ValidationError,
  type Access,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
  type Endpoint,
  type Field,
} from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { templatePreviewEndpoint } from '../endpoints/templatePreview'
import { templateTestSendEndpoint } from '../endpoints/templateTestSend'
import { EVENT_NAME_PATTERN } from '../events/names'
import { templateLifecycleEndpoints } from '../templates/lifecycle'
import { templateVariablesEndpoint, validateTemplateDoc } from '../templates/validate'
import { contentOf, normalizeLocale, sameContent, snapshotTemplate } from '../templates/versions'

export type NotificationTemplatesCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
  endpoints?: Endpoint[]
}

type BuildNotificationTemplatesCollectionArgs = {
  slug?: string
  overrides?: NotificationTemplatesCollectionOverrides
  /** Used to wire preview/test-send with live plugin options. */
  getOptions?: () => NormalizedNotificationsPluginOptions
}

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const defaultWriteAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false

/** Template keys match event names, e.g. `order.paid`, `user:signup`, `welcome-email`. */
export const TEMPLATE_SLUG_PATTERN = EVENT_NAME_PATTERN

export const validateTemplateSlug = (value: unknown): string | true => {
  if (typeof value !== 'string' || !value) return true
  return TEMPLATE_SLUG_PATTERN.test(value)
    ? true
    : 'Slug may only contain letters, numbers, and single ".", "_", ":" or "-" separators (e.g. order.paid)'
}

const engineHint =
  'Supports {{ tokens }}, {{#if}}, {{#each}}, and formatters. See docs/templates.md.'

const emailGroup: Field = {
  name: 'email',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('email'),
  },
  fields: [
    { name: 'subject', type: 'text', admin: { description: engineHint } },
    {
      name: 'htmlBody',
      type: 'code',
      admin: {
        language: 'html',
        description: `HTML email body. ${engineHint} Use {{{ raw }}} only when intentional.`,
      },
    },
    {
      name: 'textBody',
      type: 'code',
      admin: {
        language: 'plaintext',
        description: `Plain-text email body. ${engineHint}`,
      },
    },
  ],
}

const smsGroup: Field = {
  name: 'sms',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('sms'),
  },
  fields: [
    {
      name: 'body',
      type: 'textarea',
      admin: { description: `SMS body. ${engineHint}` },
    },
  ],
}

const whatsappGroup: Field = {
  name: 'whatsapp',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('whatsapp'),
  },
  fields: [
    {
      name: 'body',
      type: 'textarea',
      admin: { description: `WhatsApp text body. ${engineHint}` },
    },
    {
      name: 'hsmTemplateId',
      type: 'text',
      admin: {
        description:
          'Optional Meta HSM template id (not used for plain-text sends in this release).',
      },
    },
  ],
}

const inappGroup: Field = {
  name: 'inapp',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('inapp'),
  },
  fields: [
    { name: 'title', type: 'text', admin: { description: engineHint } },
    {
      name: 'body',
      type: 'textarea',
      admin: { description: `In-app message body. ${engineHint}` },
    },
  ],
}

const variablesField: Field = {
  name: 'variables',
  type: 'array',
  admin: {
    description: 'Documented variables for authors (not strictly enforced at render time).',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'type',
      type: 'select',
      defaultValue: 'string',
      options: ['string', 'number', 'boolean', 'date'],
    },
    { name: 'required', type: 'checkbox', defaultValue: false },
    { name: 'defaultValue', type: 'text' },
  ],
}

const templateStudioField = (collectionSlug: string): Field => ({
  name: 'templateStudio',
  type: 'ui',
  admin: {
    components: {
      Field: '@wtree/payload-notifications/admin#TemplateStudioField',
    },
    custom: {
      collectionSlug,
      apiRoute: '/api',
    },
  },
})

const baseFields = (collectionSlug: string): Field[] => [
  {
    name: 'name',
    type: 'text',
    required: true,
    index: true,
  },
  {
    name: 'slug',
    type: 'text',
    required: true,
    index: true,
    validate: validateTemplateSlug,
    admin: {
      description: 'Event key this template renders for, e.g. order.paid. Unique per locale.',
    },
  },
  {
    name: 'locale',
    type: 'text',
    index: true,
    admin: {
      description:
        'Language variant, e.g. hi or hi-IN. Leave empty for the default template used when no variant matches.',
    },
  },
  {
    name: 'description',
    type: 'textarea',
  },
  {
    name: 'channels',
    type: 'select',
    hasMany: true,
    required: true,
    options: ['email', 'sms', 'whatsapp', 'inapp', 'push'],
  },
  {
    name: 'category',
    type: 'select',
    required: true,
    defaultValue: 'transactional',
    options: ['transactional', 'marketing', 'system'],
    index: true,
  },
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'draft',
    options: ['draft', 'active', 'archived'],
    index: true,
  },
  {
    name: 'version',
    type: 'number',
    defaultValue: 1,
    index: true,
    admin: { readOnly: true, description: 'Published version' },
  },
  {
    name: 'hasUnpublishedChanges',
    type: 'checkbox',
    defaultValue: false,
    admin: {
      readOnly: true,
      description: 'Edits to an active template go live when you publish them',
    },
  },
  emailGroup,
  smsGroup,
  whatsappGroup,
  inappGroup,
  variablesField,
  templateStudioField(collectionSlug),
]

/** `req.context` flag set by the publish endpoint (it manages versions itself). */
export const TEMPLATE_PUBLISHING_CONTEXT = 'payloadNotificationsPublishingTemplate'

/**
 * Versioning on save:
 * - becoming `active` bumps `version` (the after-change hook snapshots it)
 * - editing the content of an active template flags `hasUnpublishedChanges`;
 *   sends keep using the published snapshot until the template is published
 */
const trackTemplateVersions: CollectionBeforeChangeHook = ({ data, originalDoc, context }) => {
  if (!data || context?.[TEMPLATE_PUBLISHING_CONTEXT]) return data

  const nextData = { ...data }
  const wasActive = originalDoc?.status === 'active'
  const isNowActive = (nextData.status ?? originalDoc?.status) === 'active'

  if (isNowActive && !wasActive) {
    const currentVersion = typeof originalDoc?.version === 'number' ? originalDoc.version : 0
    nextData.version = currentVersion + 1
    nextData.hasUnpublishedChanges = false
  } else if (
    wasActive &&
    isNowActive &&
    !sameContent(contentOf(originalDoc ?? {}), contentOf({ ...originalDoc, ...nextData }))
  ) {
    nextData.hasUnpublishedChanges = true
  }

  return nextData
}

/** Slugs are unique per locale (`order.paid` may have an `hi` and a default variant). */
const uniqueSlugPerLocale =
  (collectionSlug: string): CollectionBeforeValidateHook =>
  async ({ data, originalDoc, req }) => {
    const slug = data?.slug ?? originalDoc?.slug
    if (!slug || typeof req.payload?.find !== 'function') return data
    const locale = normalizeLocale(data?.locale ?? originalDoc?.locale)
    const existing = await req.payload.find({
      collection: collectionSlug as never,
      where: { slug: { equals: slug } },
      limit: 100,
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
    })
    const clash = (existing.docs as Array<{ id: string | number; locale?: string }>).find(
      (doc) => doc.id !== originalDoc?.id && normalizeLocale(doc.locale) === locale,
    )
    if (clash) {
      throw new ValidationError({
        collection: collectionSlug,
        errors: [
          {
            path: 'slug',
            message: `A template with slug "${slug}"${locale ? ` and locale "${locale}"` : ' and no locale'} already exists`,
          },
        ],
      })
    }
    return data
  }

/** Snapshots a template when it becomes active (create or status change). */
const snapshotOnActivate =
  (getOptions?: () => NormalizedNotificationsPluginOptions): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, operation, req }) => {
    if (!getOptions || doc.status !== 'active') return doc
    if (operation === 'update' && previousDoc?.status === 'active') return doc
    await snapshotTemplate({
      payload: req.payload,
      options: getOptions(),
      doc,
      version: doc.version,
      user: req.user as { id: string | number } | null,
      req,
    })
    return doc
  }

export const NotificationTemplatesCollection = ({
  slug = 'notification-templates',
  overrides,
  getOptions,
}: BuildNotificationTemplatesCollectionArgs = {}): CollectionConfig => {
  const defaultOptionsGetter = (): NormalizedNotificationsPluginOptions => {
    throw new Error('payload-notifications: template endpoints require plugin options')
  }

  const endpoints: Endpoint[] = [
    templatePreviewEndpoint('/preview', getOptions || defaultOptionsGetter),
    templateTestSendEndpoint(getOptions || defaultOptionsGetter, '/test-send'),
    ...templateLifecycleEndpoints(getOptions || defaultOptionsGetter, validateTemplateDoc),
    templateVariablesEndpoint(getOptions || defaultOptionsGetter),
    ...(overrides?.endpoints || []),
  ]

  return {
    slug,
    versions: false,
    authorship: false,
    labels: {
      singular: 'Notification Template',
      plural: 'Notification Templates',
    },
    access: {
      read: overrides?.access?.read || defaultReadAccess,
      create: overrides?.access?.create || defaultWriteAccess,
      update: overrides?.access?.update || defaultWriteAccess,
      delete: overrides?.access?.delete || denyAccess,
      admin: overrides?.access?.admin,
    },
    admin: {
      useAsTitle: 'name',
      defaultColumns: [
        'name',
        'slug',
        'locale',
        'status',
        'version',
        'hasUnpublishedChanges',
        'updatedAt',
      ],
      ...overrides?.admin,
    },
    hooks: {
      beforeValidate: [uniqueSlugPerLocale(slug)],
      beforeChange: [trackTemplateVersions],
      afterChange: [snapshotOnActivate(getOptions)],
    },
    endpoints,
    fields: overrides?.fields || baseFields(slug),
    timestamps: true,
  }
}
