import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

describe('normalizePluginOptions', () => {
  it('applies sensible defaults', () => {
    const normalized = normalizePluginOptions()

    expect(normalized.enabled).toBe(true)
    expect(normalized.channels).toEqual(['email', 'inapp'])
    expect(normalized.userCollectionSlug).toBe('users')
    expect(normalized.collections.notifications).toBe('notifications')
    expect(normalized.collections.logs).toBe('notification-logs')
    expect(normalized.jobs.queue).toBe('notifications')
    expect(normalized.rules).toEqual([])
  })

  it('deduplicates channels', () => {
    const normalized = normalizePluginOptions({
      channels: ['email', 'email', 'inapp'],
    })

    expect(normalized.channels).toEqual(['email', 'inapp'])
  })

  it('respects overrides', () => {
    const normalized = normalizePluginOptions({
      enabled: false,
      userCollectionSlug: 'customers',
      collections: {
        notifications: 'app-notifications',
        logs: 'app-notification-logs',
      },
    })

    expect(normalized.enabled).toBe(false)
    expect(normalized.userCollectionSlug).toBe('customers')
    expect(normalized.collections.notifications).toBe('app-notifications')
    expect(normalized.collections.logs).toBe('app-notification-logs')
  })

  it('throws for same notifications and logs slug', () => {
    expect(() =>
      normalizePluginOptions({
        collections: {
          notifications: 'same',
          logs: 'same',
        },
      }),
    ).toThrow('payload-notifications: notifications and logs collections must use different slugs')
  })

  it('throws when whatsapp is enabled without provider', () => {
    expect(() =>
      normalizePluginOptions({
        channels: ['whatsapp'],
      }),
    ).toThrow(
      'payload-notifications: providers.whatsapp.provider is required when whatsapp channel is enabled',
    )
  })

  it('throws when sms is enabled without provider', () => {
    expect(() =>
      normalizePluginOptions({
        channels: ['sms'],
      }),
    ).toThrow(
      'payload-notifications: providers.sms.provider is required when sms channel is enabled',
    )
  })

  it('throws when sms twilio config is incomplete', () => {
    expect(() =>
      normalizePluginOptions({
        channels: ['sms'],
        providers: {
          sms: {
            provider: 'twilio',
            accountSid: 'sid',
          },
        },
      }),
    ).toThrow('payload-notifications: Twilio SMS requires accountSid, authToken, and from')
  })

  it('throws for unknown channels', () => {
    expect(() =>
      normalizePluginOptions({
        channels: ['pigeon' as any],
      }),
    ).toThrow('payload-notifications: unknown channel "pigeon"')
  })

  it('throws for empty channels array', () => {
    expect(() =>
      normalizePluginOptions({
        channels: [],
      }),
    ).toThrow('payload-notifications: at least one channel must be enabled')
  })
})
