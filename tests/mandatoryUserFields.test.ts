import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { evaluateNotificationPolicy } from '../src/policy/evaluatePolicy'

const user = { notificationPreferences: { channels: { email: false } } }
const input = (classification: 'transactional' | 'marketing') => ({
  userId: 'u1',
  channel: 'email' as const,
  template: 'order-confirmed',
  event: 'order.confirmed',
  classification,
})
const options = (mandatoryInUserFields?: boolean, mandatoryCategories?: string[]) =>
  normalizePluginOptions({
    preferences: {
      fields: { channels: 'notificationPreferences.channels' },
      mandatoryInUserFields,
      mandatoryCategories,
    },
  })

describe('preferences.mandatoryInUserFields', () => {
  it('is off by default: user-field opt-outs block transactional sends', async () => {
    const result = await evaluateNotificationPolicy({
      user,
      input: input('transactional'),
      options: options(),
    })
    expect(result.allow).toBe(false)
  })

  it('lets transactional sends through when enabled', async () => {
    const result = await evaluateNotificationPolicy({
      user,
      input: input('transactional'),
      options: options(true),
    })
    expect(result.allow).toBe(true)
  })

  it('still blocks marketing sends when enabled', async () => {
    const result = await evaluateNotificationPolicy({
      user,
      input: input('marketing'),
      options: options(true),
    })
    expect(result.allow).toBe(false)
  })

  it('honours listed categories', async () => {
    const result = await evaluateNotificationPolicy({
      user,
      input: input('marketing'),
      options: options(true, ['account-security']),
      category: 'account-security',
    })
    expect(result.allow).toBe(true)
  })
})
