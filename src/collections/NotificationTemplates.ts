import type { Access, CollectionConfig, Field } from 'payload'

export type NotificationTemplatesCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
}

type BuildNotificationTemplatesCollectionArgs = {
  slug?: string
  overrides?: NotificationTemplatesCollectionOverrides
}

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const defaultWriteAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false

const emailGroup: Field = {
  name: 'email',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('email'),
  },
  fields: [
    { name: 'subject', type: 'text' },
    { name: 'htmlBody', type: 'textarea' },
    { name: 'textBody', type: 'textarea' },
  ],
}

const smsGroup: Field = {
  name: 'sms',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('sms'),
  },
  fields: [{ name: 'body', type: 'textarea' }],
}

const whatsappGroup: Field = {
  name: 'whatsapp',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('whatsapp'),
  },
  fields: [
    { name: 'body', type: 'textarea' },
    { name: 'hsmTemplateId', type: 'text' },
  ],
}

const inappGroup: Field = {
  name: 'inapp',
  type: 'group',
  admin: {
    condition: (_, siblingData) => siblingData?.channels?.includes?.('inapp'),
  },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'body', type: 'textarea' },
  ],
}

const variablesField: Field = {
  name: 'variables',
  type: 'array',
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

const baseFields: Field[] = [
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
}: BuildNotificationTemplatesCollectionArgs = {}): CollectionConfig => ({
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
    defaultColumns: ['name', 'slug', 'category', 'status', 'version', 'updatedAt'],
    ...overrides?.admin,
  },
  hooks: {
    beforeChange: [autoIncrementVersion],
  },
  fields: overrides?.fields || baseFields,
  timestamps: true,
})
