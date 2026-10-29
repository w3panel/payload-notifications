import type { Access, CollectionConfig, Where } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { versionedCollectionDefaults } from '../compat'

export const SUPPRESSION_REASONS = ['bounce', 'complaint', 'stop', 'invalid', 'manual'] as const

/**
 * Per-user notification preferences (collection mode): one record per user ×
 * channel × category, `*` meaning any. Users can read and change their own.
 */
export const NotificationPreferencesCollection = ({
  slug,
  userCollectionSlug,
  getOptions,
}: {
  slug: string
  userCollectionSlug: string
  getOptions: () => NormalizedNotificationsPluginOptions
}): CollectionConfig => {
  const ownOrAdmin: Access = async ({ req }) => {
    if (!req.user) return false
    if (await getOptions().access.manageTriggers({ req })) return true
    return { user: { equals: req.user.id } } as Where
  }
  return {
    slug,
    versions: false,
    ...versionedCollectionDefaults(),
    labels: { singular: 'Notification Preference', plural: 'Notification Preferences' },
    access: { read: ownOrAdmin, create: ownOrAdmin, update: ownOrAdmin, delete: ownOrAdmin },
    admin: {
      useAsTitle: 'category',
      defaultColumns: ['user', 'category', 'channel', 'enabled', 'consentAt'],
    },
    fields: [
      {
        name: 'user',
        type: 'relationship',
        relationTo: userCollectionSlug,
        required: true,
        index: true,
      },
      {
        name: 'channel',
        type: 'select',
        required: true,
        defaultValue: '*',
        options: ['*', 'email', 'sms', 'whatsapp', 'inapp', 'push'],
        index: true,
      },
      {
        name: 'category',
        type: 'text',
        required: true,
        defaultValue: '*',
        index: true,
        admin: { description: 'Trigger category (or transactional / marketing); * for all' },
      },
      { name: 'enabled', type: 'checkbox', required: true, defaultValue: true },
      { name: 'consentAt', type: 'date' },
      {
        name: 'consentSource',
        type: 'text',
        admin: { description: 'e.g. signup-form, unsubscribe-link, admin' },
      },
    ],
    timestamps: true,
  }
}

/** Destinations that must not be contacted (bounces, complaints, STOP replies). */
export const NotificationSuppressionsCollection = ({
  slug,
  getOptions,
}: {
  slug: string
  getOptions: () => NormalizedNotificationsPluginOptions
}): CollectionConfig => {
  const admin: Access = ({ req }) =>
    Boolean(req.user) && getOptions().access.manageTriggers({ req })
  return {
    slug,
    versions: false,
    ...versionedCollectionDefaults(),
    labels: { singular: 'Notification Suppression', plural: 'Notification Suppressions' },
    access: { read: admin, create: admin, update: admin, delete: admin },
    admin: {
      useAsTitle: 'destination',
      defaultColumns: ['destination', 'channel', 'reason', 'createdAt'],
    },
    fields: [
      { name: 'destination', type: 'text', required: true, index: true },
      { name: 'channel', type: 'select', options: ['email', 'sms', 'whatsapp'], index: true },
      {
        name: 'reason',
        type: 'select',
        required: true,
        options: [...SUPPRESSION_REASONS],
        index: true,
      },
      { name: 'source', type: 'text' },
      { name: 'note', type: 'textarea' },
    ],
    timestamps: true,
  }
}
