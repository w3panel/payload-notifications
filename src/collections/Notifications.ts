import type { Access, CollectionConfig, Field, GroupField } from 'payload'
import { versionedCollectionDefaults } from '../compat'

export type NotificationsCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
}

type BuildNotificationCollectionArgs = {
  userCollectionSlug?: string
  slug?: string
  overrides?: NotificationsCollectionOverrides
}

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false

export const buildNotificationMetaField = (): GroupField => ({
  name: 'meta',
  type: 'group',
  fields: [
    {
      name: 'link',
      type: 'text',
    },
    {
      name: 'entityType',
      type: 'text',
    },
    {
      name: 'entityID',
      type: 'text',
      index: true,
    },
    {
      name: 'data',
      type: 'json',
    },
  ],
})

const baseFields = (userCollectionSlug: string): Field[] => [
  {
    name: 'title',
    type: 'text',
    required: true,
    index: true,
  },
  {
    name: 'message',
    type: 'textarea',
    required: true,
  },
  {
    name: 'recipient',
    type: 'relationship',
    relationTo: userCollectionSlug,
    required: true,
    index: true,
  },
  {
    name: 'channel',
    type: 'select',
    required: true,
    defaultValue: 'inapp',
    options: ['inapp'],
    index: true,
  },
  {
    name: 'type',
    type: 'select',
    required: true,
    defaultValue: 'transactional',
    options: ['transactional', 'marketing', 'system'],
    index: true,
  },
  {
    name: 'priority',
    type: 'select',
    required: true,
    defaultValue: 'normal',
    options: ['low', 'normal', 'high', 'urgent'],
    index: true,
  },
  {
    name: 'isRead',
    type: 'checkbox',
    defaultValue: false,
    index: true,
  },
  {
    name: 'readAt',
    type: 'date',
    index: true,
    admin: {
      readOnly: true,
      condition: (_, siblingData) => Boolean(siblingData?.isRead),
    },
  },
  {
    name: 'deliveredAt',
    type: 'date',
    index: true,
  },
  buildNotificationMetaField(),
]

export const NotificationsCollection = ({
  userCollectionSlug = 'users',
  slug = 'notifications',
  overrides,
}: BuildNotificationCollectionArgs = {}): CollectionConfig => ({
  slug,
  versions: false,
  ...versionedCollectionDefaults(),
  labels: {
    singular: 'Notification',
    plural: 'Notifications',
  },
  access: {
    read: overrides?.access?.read || defaultReadAccess,
    create: overrides?.access?.create || denyAccess,
    update: overrides?.access?.update || denyAccess,
    delete: overrides?.access?.delete || denyAccess,
    admin: overrides?.access?.admin,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'recipient', 'type', 'priority', 'isRead', 'createdAt'],
    ...overrides?.admin,
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (!data) return data

        const nextData = { ...data }
        if (nextData.isRead && !nextData.readAt) {
          nextData.readAt = new Date().toISOString()
        }
        if (!nextData.isRead) {
          nextData.readAt = null
        }
        if (!nextData.deliveredAt) {
          nextData.deliveredAt = new Date().toISOString()
        }
        return nextData
      },
    ],
  },
  fields: overrides?.fields || baseFields(userCollectionSlug),
  timestamps: true,
})
