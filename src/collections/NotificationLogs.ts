import type { Access, CollectionConfig, Field, GroupField } from 'payload'
import { versionedCollectionDefaults } from '../compat'

export type NotificationLogsCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
}

type BuildNotificationLogsCollectionArgs = {
  userCollectionSlug?: string
  slug?: string
  overrides?: NotificationLogsCollectionOverrides
}

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false

export const buildProviderResponseField = (): GroupField => ({
  name: 'providerResponse',
  type: 'group',
  fields: [
    {
      name: 'provider',
      type: 'text',
      index: true,
    },
    {
      name: 'messageID',
      type: 'text',
      index: true,
    },
    {
      name: 'requestID',
      type: 'text',
      index: true,
    },
    {
      name: 'raw',
      type: 'json',
    },
  ],
})

const baseFields = (userCollectionSlug: string): Field[] => [
  {
    name: 'user',
    type: 'relationship',
    relationTo: userCollectionSlug,
    index: true,
  },
  {
    name: 'event',
    type: 'text',
    required: true,
    index: true,
  },
  {
    name: 'channel',
    type: 'select',
    required: true,
    options: ['email', 'whatsapp', 'sms', 'inapp', 'push'],
    index: true,
  },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: ['queued', 'sent', 'stored', 'failed', 'skipped'],
    index: true,
  },
  {
    name: 'template',
    type: 'text',
    index: true,
  },
  {
    name: 'fingerprint',
    type: 'text',
    index: true,
  },
  {
    name: 'idempotencyKey',
    type: 'text',
    index: true,
  },
  {
    name: 'attempt',
    type: 'number',
    defaultValue: 1,
    index: true,
  },
  {
    name: 'failureClassification',
    type: 'select',
    options: ['retriable', 'terminal'],
    index: true,
  },
  {
    name: 'templateSlug',
    type: 'text',
    index: true,
  },
  {
    name: 'templateVersion',
    type: 'number',
    index: true,
  },
  {
    name: 'renderDurationMs',
    type: 'number',
  },
  {
    name: 'error',
    type: 'textarea',
  },
  buildProviderResponseField(),
  {
    name: 'meta',
    type: 'json',
  },
]

export const NotificationLogsCollection = ({
  userCollectionSlug = 'users',
  slug = 'notification-logs',
  overrides,
}: BuildNotificationLogsCollectionArgs = {}): CollectionConfig => ({
  slug,
  versions: false,
  ...versionedCollectionDefaults(),
  labels: {
    singular: 'Notification Log',
    plural: 'Notification Logs',
  },
  access: {
    read: overrides?.access?.read || defaultReadAccess,
    create: overrides?.access?.create || denyAccess,
    update: overrides?.access?.update || denyAccess,
    delete: overrides?.access?.delete || denyAccess,
    admin: overrides?.access?.admin,
  },
  admin: {
    useAsTitle: 'event',
    defaultColumns: ['event', 'channel', 'status', 'user', 'attempt', 'createdAt'],
    ...overrides?.admin,
  },
  fields: overrides?.fields || baseFields(userCollectionSlug),
  timestamps: true,
})
