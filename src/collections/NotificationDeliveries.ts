import type { Access, CollectionConfig, Field, FieldAccess } from 'payload'

export type NotificationDeliveriesCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
}

type BuildNotificationDeliveriesCollectionArgs = {
  slug?: string
  overrides?: NotificationDeliveriesCollectionOverrides
}

export const DELIVERY_STATUSES = [
  'planned',
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'skipped',
  'cancelled',
  'unknown',
] as const

const defaultReadAccess: Access = ({ req }) => Boolean(req.user)
const denyAccess: Access = () => false
/** Server-only fields: readable with `overrideAccess`, never through the API or admin. */
const serverOnly: { read: FieldAccess; update: FieldAccess; create: FieldAccess } = {
  read: () => false,
  update: () => false,
  create: () => false,
}

const baseFields: Field[] = [
  { name: 'event', type: 'text', required: true, index: true },
  { name: 'eventId', type: 'text', index: true },
  { name: 'trigger', type: 'text', required: true, index: true },
  { name: 'triggerOrigin', type: 'select', options: ['code', 'admin'] },
  { name: 'triggerVersion', type: 'number' },
  { name: 'triggerPolicy', type: 'text' },
  {
    name: 'channel',
    type: 'select',
    required: true,
    index: true,
    options: ['email', 'whatsapp', 'sms', 'inapp', 'push'],
  },
  { name: 'templateSlug', type: 'text', index: true },
  { name: 'templateVersion', type: 'number' },
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'queued',
    index: true,
    options: [...DELIVERY_STATUSES],
  },
  { name: 'attempts', type: 'number', defaultValue: 0 },
  { name: 'maxAttempts', type: 'number', defaultValue: 1 },
  { name: 'retryPolicy', type: 'json', access: serverOnly, admin: { hidden: true } },
  { name: 'nextAttemptAt', type: 'date' },
  { name: 'recipientKey', type: 'text', index: true },
  { name: 'recipientId', type: 'text', index: true },
  { name: 'recipientAlias', type: 'text' },
  { name: 'destinationMasked', type: 'text' },
  {
    name: 'destination',
    type: 'text',
    access: serverOnly,
    admin: { hidden: true },
  },
  { name: 'classification', type: 'select', options: ['transactional', 'marketing'] },
  {
    name: 'idempotencyKey',
    type: 'text',
    required: true,
    unique: true,
    index: true,
  },
  { name: 'dedupeKey', type: 'text', index: true },
  { name: 'providerMessageId', type: 'text', index: true },
  { name: 'scheduledFor', type: 'date', index: true },
  { name: 'recheckConditions', type: 'checkbox', defaultValue: false },
  { name: 'sentAt', type: 'date' },
  { name: 'deliveredAt', type: 'date' },
  { name: 'lastError', type: 'textarea' },
  { name: 'skipReason', type: 'text' },
  { name: 'test', type: 'checkbox', defaultValue: false, index: true },
  {
    name: 'context',
    type: 'json',
    access: serverOnly,
    admin: { hidden: true },
  },
  {
    name: 'templateOverrides',
    type: 'json',
    access: serverOnly,
    admin: { hidden: true },
  },
]

/**
 * One logical message: one recipient, one channel, one trigger version. Send
 * jobs process deliveries by ID; attempts are recorded in notification-logs.
 */
export const NotificationDeliveriesCollection = ({
  slug = 'notification-deliveries',
  overrides,
}: BuildNotificationDeliveriesCollectionArgs = {}): CollectionConfig => ({
  slug,
  versions: false,
  authorship: false,
  labels: {
    singular: 'Notification Delivery',
    plural: 'Notification Deliveries',
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
    defaultColumns: ['event', 'trigger', 'channel', 'status', 'destinationMasked', 'createdAt'],
    ...overrides?.admin,
  },
  fields: overrides?.fields || baseFields,
  timestamps: true,
})
