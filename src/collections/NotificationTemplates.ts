import type { Access, CollectionConfig, Endpoint, Field } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { templatePreviewEndpoint } from '../endpoints/templatePreview'
import { templateTestSendEndpoint } from '../endpoints/templateTestSend'
import { versionedCollectionDefaults } from '../compat'

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
    unique: true,
    index: true,
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
    admin: { readOnly: true },
  },
  emailGroup,
  smsGroup,
  whatsappGroup,
  inappGroup,
  variablesField,
  templateStudioField(collectionSlug),
]

/**
 * Auto-increment version when status transitions to 'active'.
 */
const autoIncrementVersion = ({
  data,
  originalDoc,
}: {
  data?: Record<string, unknown>
  originalDoc?: Record<string, unknown>
}) => {
  if (!data) return data

  const nextData = { ...data }
  const wasActive = originalDoc?.status === 'active'
  const isNowActive = nextData.status === 'active'

  if (isNowActive && !wasActive) {
    const currentVersion = typeof originalDoc?.version === 'number' ? originalDoc.version : 0
    nextData.version = currentVersion + 1
  }

  return nextData
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
    templatePreviewEndpoint('/preview'),
    templateTestSendEndpoint(getOptions || defaultOptionsGetter, '/test-send'),
    ...(overrides?.endpoints || []),
  ]

  return {
    slug,
    versions: false,
    ...versionedCollectionDefaults(),
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
      defaultColumns: ['name', 'slug', 'category', 'status', 'version', 'updatedAt'],
      ...overrides?.admin,
    },
    hooks: {
      beforeChange: [autoIncrementVersion],
    },
    endpoints,
    fields: overrides?.fields || baseFields(slug),
    timestamps: true,
  }
}
