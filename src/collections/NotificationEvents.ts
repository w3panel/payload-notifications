import type { Access, CollectionConfig, Field, FieldAccess } from 'payload'
import { versionedCollectionDefaults } from '../compat'

export type NotificationEventsCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
}

export const EVENT_INBOX_STATUSES = ['received', 'processing', 'processed', 'failed'] as const

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false
/** Event payloads may hold secrets (magic links, OTPs): server-only, never via API or admin. */
const serverOnly: { read: FieldAccess; update: FieldAccess; create: FieldAccess } = {
  read: () => false,
  update: () => false,
  create: () => false,
}

const baseFields: Field[] = [
  { name: 'eventId', type: 'text', required: true, unique: true, index: true },
  { name: 'name', type: 'text', required: true, index: true },
  { name: 'sourceType', type: 'select', options: ['application', 'collection'], index: true },
  { name: 'userId', type: 'text', index: true },
  { name: 'tenant', type: 'text', index: true },
  { name: 'classification', type: 'select', options: ['transactional', 'marketing'] },
  { name: 'idempotencyKey', type: 'text', index: true },
  { name: 'depth', type: 'number' },
  { name: 'occurredAt', type: 'date', index: true },
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'received',
    index: true,
    options: [...EVENT_INBOX_STATUSES],
  },
  { name: 'attempts', type: 'number', defaultValue: 0 },
  { name: 'matched', type: 'json' },
  { name: 'deliveries', type: 'number' },
  { name: 'error', type: 'textarea' },
  { name: 'processedAt', type: 'date' },
  { name: 'event', type: 'json', access: serverOnly, admin: { hidden: true } },
]

/**
 * Optional durable inbox (`eventsInbox: true`): one record per emitted event
 * with its processing status, for audit and replay.
 */
export const NotificationEventsCollection = ({
  slug = 'notification-events',
  overrides,
}: {
  slug?: string
  overrides?: NotificationEventsCollectionOverrides
} = {}): CollectionConfig => ({
  slug,
  versions: false,
  ...versionedCollectionDefaults(),
  labels: {
    singular: 'Notification Event',
    plural: 'Notification Events',
  },
  access: {
    read: overrides?.access?.read || defaultReadAccess,
    create: overrides?.access?.create || denyAccess,
    update: overrides?.access?.update || denyAccess,
    delete: overrides?.access?.delete || denyAccess,
    admin: overrides?.access?.admin,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'sourceType', 'deliveries', 'occurredAt'],
    ...overrides?.admin,
  },
  fields: overrides?.fields || baseFields,
  timestamps: true,
})
