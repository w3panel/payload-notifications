import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { buildDataContext } from '../src/data/buildContext'
import {
  createSensitiveFieldMatcher,
  isSensitivePath,
  REDACTED,
  redactContext,
  stripSensitiveFields,
} from '../src/data/sensitive'
import { validateDataSources } from '../src/data/sources'

describe('sensitive field matcher', () => {
  it('matches built-in names and token/secret patterns case-insensitively', () => {
    const isSensitive = createSensitiveFieldMatcher()
    for (const key of [
      'password',
      'Hash',
      'salt',
      'apiKey',
      'resetPasswordToken',
      'accessToken',
      'clientSecret',
      'sessions',
    ]) {
      expect(isSensitive(key)).toBe(true)
    }
    for (const key of ['name', 'email', 'phone', 'total']) {
      expect(isSensitive(key)).toBe(false)
    }
  })

  it('supports extra names and dot paths', () => {
    const isSensitive = createSensitiveFieldMatcher(['ssn'])
    expect(isSensitive('SSN')).toBe(true)
    expect(isSensitivePath('profile.ssn', isSensitive)).toBe(true)
    expect(isSensitivePath('profile.name', isSensitive)).toBe(false)
  })
})

describe('stripSensitiveFields', () => {
  it('removes sensitive keys deeply, including inside arrays', () => {
    expect(
      stripSensitiveFields({
        name: 'Alex',
        apiKey: 'k',
        profile: { password: 'p', city: 'Kochi' },
        devices: [{ pushToken: 't', model: 'x' }],
        createdAt: new Date(0),
      }),
    ).toEqual({
      name: 'Alex',
      profile: { city: 'Kochi' },
      devices: [{ model: 'x' }],
      createdAt: new Date(0),
    })
  })
})

describe('redactContext', () => {
  it('masks sensitive keys and configured paths without mutating the input', () => {
    const context = {
      customer: { name: 'Alex', phone: '+919876543210', apiKey: 'k' },
      items: [
        { sku: 'A', price: 1 },
        { sku: 'B', price: 2 },
      ],
      payload: { otp: '123456' },
    }
    const redacted = redactContext(context, [
      'customer.phone',
      'items.price',
      'payload.otp',
      'missing.path',
    ])
    expect(redacted).toEqual({
      customer: { name: 'Alex', phone: REDACTED, apiKey: REDACTED },
      items: [
        { sku: 'A', price: REDACTED },
        { sku: 'B', price: REDACTED },
      ],
      payload: { otp: REDACTED },
    })
    expect(context.customer.phone).toBe('+919876543210')
  })

  it('supports explicit array indexes and wildcards', () => {
    const value = { items: [{ sku: 'A' }, { sku: 'B' }] }
    expect(redactContext(value, ['items.0.sku']).items).toEqual([{ sku: REDACTED }, { sku: 'B' }])
    expect(redactContext(value, ['items.*.sku']).items).toEqual([
      { sku: REDACTED },
      { sku: REDACTED },
    ])
  })
})

describe('sensitive fields in configuration and resolution', () => {
  it('rejects allowlisting users.password', () => {
    expect(() =>
      normalizePluginOptions({
        data: { collections: { users: { fields: ['name', 'password'] } } },
      }),
    ).toThrow('data.collections["users"] field "password" is sensitive')
    expect(() =>
      normalizePluginOptions({
        data: { sensitiveFields: ['ssn'], collections: { users: { fields: ['profile.ssn'] } } },
      }),
    ).toThrow('field "profile.ssn" is sensitive')
  })

  it('rejects sensitive fields on event and document sources', () => {
    expect(
      validateDataSources([{ type: 'document', alias: 'user', fields: ['email', 'hash'] }], {
        allowlist: {},
      }),
    ).toEqual(['data sources source "user": field "hash" is sensitive and cannot be loaded'])
  })

  it('strips sensitive output from resolvers, lookups and documents', async () => {
    const payload = {
      findByID: mock(async () => ({ id: 'u1', name: 'Alex', salt: 's' })),
    }
    const result = await buildDataContext({
      payload: payload as never,
      event: { name: 'order.paid', payload: { userId: 'u1', magicToken: 'kept' } },
      doc: { id: 'd1', status: 'paid', secretNote: 'x' },
      sources: [
        {
          type: 'collection',
          alias: 'customer',
          collection: 'users',
          lookup: { type: 'id', from: 'event.payload.userId' },
          // Bypasses validation on purpose: runtime stripping is the second line of defence.
          fields: ['name', 'salt'],
        },
        { type: 'resolver', alias: 'store', name: 'storeDetails' },
      ],
      dataResolvers: {
        storeDetails: { handler: () => ({ name: 'Store', apiKey: 'leak', webhookSecret: 'leak' }) },
      },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.context.customer).toEqual({ id: 'u1', name: 'Alex' })
    expect(result.context.store).toEqual({ name: 'Store' })
    expect(result.context.doc).toEqual({ id: 'd1', status: 'paid' })
    // Developer-provided event payloads are passed through unchanged.
    expect(result.context.payload).toEqual({ userId: 'u1', magicToken: 'kept' })
  })
})
