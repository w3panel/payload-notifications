import type {
  Access,
  CollectionBeforeChangeHook,
  CollectionConfig,
  Endpoint,
  Field,
  FieldAccess,
} from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { definitionOf, sameDefinition } from '../admin-triggers/record'
import { validateTemplateSlug } from './NotificationTemplates'

export type NotificationTriggersCollectionOverrides = {
  access?: Partial<CollectionConfig['access']>
  admin?: Partial<CollectionConfig['admin']>
  fields?: Field[]
  endpoints?: Endpoint[]
}

export const TRIGGER_STATUSES = ['draft', 'validated', 'published', 'disabled', 'archived'] as const

const serverManaged: { create: FieldAccess; update: FieldAccess } = {
  create: () => false,
  update: () => false,
}

const jsonOf =
  (kind: 'object' | 'array', label: string) =>
  (value: unknown): true | string => {
    if (value === undefined || value === null || value === '') return true
    if (kind === 'array') return Array.isArray(value) || `${label} must be a JSON array`
    return (typeof value === 'object' && !Array.isArray(value)) || `${label} must be a JSON object`
  }

const definitionFields: Field[] = [
  {
    name: 'source',
    type: 'json',
    validate: jsonOf('object', 'source'),
    admin: {
      description:
        "{ type: 'event', event } or { type: 'collection', collection, operation }. Not used by managed overrides.",
    },
  },
  { name: 'conditions', type: 'json', validate: jsonOf('object', 'conditions') },
  { name: 'data', type: 'json', validate: jsonOf('object', 'data') },
  { name: 'recipients', type: 'json', validate: jsonOf('array', 'recipients') },
  { name: 'deliveries', type: 'json', validate: jsonOf('array', 'deliveries') },
  { name: 'schedule', type: 'json', validate: jsonOf('object', 'schedule') },
  { name: 'dedupe', type: 'json', validate: jsonOf('object', 'dedupe') },
  { name: 'reliability', type: 'json', validate: jsonOf('object', 'reliability') },
]

const baseFields = (collectionSlug: string, userCollectionSlug: string): Field[] => [
  { name: 'name', type: 'text', required: true },
  {
    name: 'slug',
    type: 'text',
    required: true,
    unique: true,
    index: true,
    validate: validateTemplateSlug,
    admin: { description: 'Stable identifier, e.g. order-paid-ops. Deliveries reference it.' },
  },
  { name: 'description', type: 'textarea' },
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'draft',
    index: true,
    options: [...TRIGGER_STATUSES],
    access: serverManaged,
    admin: {
      readOnly: true,
      position: 'sidebar',
      description: 'Changed by Validate / Publish / Disable',
    },
  },
  {
    name: 'version',
    type: 'number',
    defaultValue: 0,
    access: serverManaged,
    admin: { readOnly: true, position: 'sidebar', description: 'Published version' },
  },
  {
    name: 'hasUnpublishedChanges',
    type: 'checkbox',
    defaultValue: false,
    access: serverManaged,
    admin: { readOnly: true, position: 'sidebar' },
  },
  {
    name: 'publishedAt',
    type: 'date',
    access: serverManaged,
    admin: { readOnly: true, position: 'sidebar' },
  },
  {
    name: 'publishedBy',
    type: 'relationship',
    relationTo: userCollectionSlug,
    access: serverManaged,
    admin: { readOnly: true, position: 'sidebar' },
  },
  {
    name: 'overrides',
    type: 'text',
    index: true,
    admin: {
      description:
        'Slug of a managed code trigger this record customizes (leave empty for a new trigger)',
    },
  },
  {
    name: 'classification',
    type: 'select',
    options: ['transactional', 'marketing'],
  },
  {
    name: 'category',
    type: 'text',
    admin: {
      description: 'Preference category users can opt out of (defaults to the classification)',
    },
  },
  {
    name: 'builder',
    type: 'ui',
    admin: {
      components: { Field: '@wtree/payload-notifications/admin#TriggerBuilderField' },
      custom: { collectionSlug, apiRoute: '/api' },
    },
  },
  {
    type: 'collapsible',
    label: 'Definition (JSON)',
    admin: { initCollapsed: true },
    fields: definitionFields,
  },
  {
    name: 'validation',
    type: 'json',
    access: serverManaged,
    admin: { readOnly: true, description: 'Latest validation report' },
  },
]

/**
 * Tracks unpublished edits: changing the definition of a published or disabled
 * trigger flags `hasUnpublishedChanges` (the live snapshot is untouched);
 * editing a validated draft sends it back to `draft`.
 */
export const trackDefinitionChanges: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
}) => {
  if (operation !== 'update' || !originalDoc || !data) return data
  const before = definitionOf(originalDoc)
  const after = definitionOf({ ...originalDoc, ...data })
  if (sameDefinition(before, after)) return data

  const status = originalDoc.status
  if (status === 'published' || status === 'disabled')
    return { ...data, hasUnpublishedChanges: true }
  if (status === 'validated') return { ...data, status: 'draft', validation: null }
  return data
}

type BuildArgs = {
  slug?: string
  userCollectionSlug?: string
  overrides?: NotificationTriggersCollectionOverrides
  getOptions: () => NormalizedNotificationsPluginOptions
  endpoints?: Endpoint[]
}

/** Admin-created notification triggers (working copies; published snapshots live in versions). */
export const NotificationTriggersCollection = ({
  slug = 'notification-triggers',
  userCollectionSlug = 'users',
  overrides,
  getOptions,
  endpoints = [],
}: BuildArgs): CollectionConfig => {
  const manage: Access = ({ req }) => getOptions().access.manageTriggers({ req })
  const read: Access = ({ req }) => Boolean(req.user)

  return {
    slug,
    versions: false,
    authorship: false,
    labels: { singular: 'Notification Trigger', plural: 'Notification Triggers' },
    access: {
      read: overrides?.access?.read || read,
      create: overrides?.access?.create || manage,
      update: overrides?.access?.update || manage,
      delete: overrides?.access?.delete || manage,
      admin: overrides?.access?.admin,
    },
    admin: {
      useAsTitle: 'name',
      defaultColumns: ['name', 'slug', 'status', 'version', 'hasUnpublishedChanges', 'updatedAt'],
      components: {
        beforeList: ['@wtree/payload-notifications/admin#CodeTriggersList'],
      },
      ...overrides?.admin,
    },
    hooks: { beforeChange: [trackDefinitionChanges] },
    endpoints: [...endpoints, ...(overrides?.endpoints || [])],
    fields: overrides?.fields || baseFields(slug, userCollectionSlug),
    timestamps: true,
  }
}
