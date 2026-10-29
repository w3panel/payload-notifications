import type { Access, CollectionConfig } from 'payload'

/**
 * Immutable published snapshots of notification templates. Written on publish;
 * sends render from these (deliveries pin the version they were planned with).
 */
export const NotificationTemplateVersionsCollection = ({
  slug = 'notification-template-versions',
  templatesSlug = 'notification-templates',
  userCollectionSlug = 'users',
}: {
  slug?: string
  templatesSlug?: string
  userCollectionSlug?: string
} = {}): CollectionConfig => {
  const read: Access = ({ req }) => Boolean(req.user)
  const deny: Access = () => false
  return {
    slug,
    versions: false,
    authorship: false,
    labels: { singular: 'Notification Template Version', plural: 'Notification Template Versions' },
    access: { read, create: deny, update: deny, delete: deny },
    admin: {
      useAsTitle: 'slug',
      defaultColumns: ['slug', 'locale', 'version', 'publishedAt'],
      hidden: true,
    },
    fields: [
      {
        name: 'template',
        type: 'relationship',
        relationTo: templatesSlug,
        required: true,
        index: true,
      },
      { name: 'slug', type: 'text', required: true, index: true },
      { name: 'locale', type: 'text', index: true },
      { name: 'version', type: 'number', required: true, index: true },
      { name: 'content', type: 'json', required: true },
      { name: 'publishedAt', type: 'date', required: true },
      { name: 'publishedBy', type: 'relationship', relationTo: userCollectionSlug },
    ],
    timestamps: true,
  }
}
