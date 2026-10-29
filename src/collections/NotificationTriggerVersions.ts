import type { Access, CollectionConfig } from 'payload'

/**
 * Immutable published snapshots of admin triggers. Written only by the publish
 * endpoint (server-side); the engine runs these, never the editable documents.
 */
export const NotificationTriggerVersionsCollection = ({
  slug = 'notification-trigger-versions',
  triggersSlug = 'notification-triggers',
  userCollectionSlug = 'users',
}: {
  slug?: string
  triggersSlug?: string
  userCollectionSlug?: string
} = {}): CollectionConfig => {
  const read: Access = ({ req }) => Boolean(req.user)
  const deny: Access = () => false
  return {
    slug,
    versions: false,
    authorship: false,
    labels: { singular: 'Notification Trigger Version', plural: 'Notification Trigger Versions' },
    access: { read, create: deny, update: deny, delete: deny },
    admin: {
      useAsTitle: 'slug',
      defaultColumns: ['slug', 'version', 'publishedAt'],
      hidden: true,
    },
    fields: [
      {
        name: 'trigger',
        type: 'relationship',
        relationTo: triggersSlug,
        required: true,
        index: true,
      },
      { name: 'slug', type: 'text', required: true, index: true },
      { name: 'name', type: 'text' },
      { name: 'version', type: 'number', required: true, index: true },
      { name: 'definition', type: 'json', required: true },
      { name: 'publishedAt', type: 'date', required: true },
      { name: 'publishedBy', type: 'relationship', relationTo: userCollectionSlug },
    ],
    timestamps: true,
  }
}
