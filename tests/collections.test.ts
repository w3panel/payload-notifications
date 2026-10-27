import { describe, expect, it } from 'bun:test'
import {
  NotificationsCollection,
  buildNotificationMetaField,
} from '../src/collections/Notifications'
import {
  NotificationLogsCollection,
  buildProviderResponseField,
} from '../src/collections/NotificationLogs'

describe('collection schemas', () => {
  it('builds notifications collection with production fields', () => {
    const collection = NotificationsCollection()
    const fieldNames = collection.fields.map((field) => ('name' in field ? field.name : ''))

    expect(collection.slug).toBe('notifications')
    expect(fieldNames).toContain('title')
    expect(fieldNames).toContain('recipient')
    expect(fieldNames).toContain('isRead')
    expect(fieldNames).toContain('readAt')
    expect(fieldNames).toContain('deliveredAt')
    expect(fieldNames).toContain('meta')
  })

  it('builds notification logs collection with indexed analytics fields', () => {
    const collection = NotificationLogsCollection()
    const fieldNames = collection.fields.map((field) => ('name' in field ? field.name : ''))

    expect(collection.slug).toBe('notification-logs')
    expect(fieldNames).toContain('event')
    expect(fieldNames).toContain('channel')
    expect(fieldNames).toContain('status')
    expect(fieldNames).toContain('template')
    expect(fieldNames).toContain('idempotencyKey')
    expect(fieldNames).toContain('fingerprint')
    expect(fieldNames).toContain('failureClassification')
    expect(fieldNames).toContain('attempt')
    expect(fieldNames).toContain('providerResponse')
  })

  it('supports slug and access/admin overrides', () => {
    const collection = NotificationsCollection({
      slug: 'app-notifications',
      overrides: {
        admin: {
          useAsTitle: 'message',
        },
      },
    })

    expect(collection.slug).toBe('app-notifications')
    expect(collection.admin?.useAsTitle).toBe('message')
  })

  it('builds shared meta and provider response field helpers', () => {
    const metaField = buildNotificationMetaField()
    const providerField = buildProviderResponseField()

    expect(metaField.name).toBe('meta')
    expect(providerField.name).toBe('providerResponse')
  })
})
