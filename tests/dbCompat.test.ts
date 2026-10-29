import { describe, expect, it } from 'bun:test'
import { toRelationId } from '../src/data/ids'
import { isDuplicateKeyError } from '../src/data/errors'

const payload = (defaultIDType: string, customIDs: Record<string, string> = {}) =>
  ({
    db: { defaultIDType },
    collections: Object.fromEntries(
      Object.entries(customIDs).map(([slug, type]) => [slug, { customIDType: type }]),
    ),
  }) as never

describe('database compatibility helpers', () => {
  it('converts relationship IDs to the target ID type', () => {
    expect(toRelationId(payload('number'), 'users', '12')).toBe(12)
    expect(toRelationId(payload('number'), 'users', 12)).toBe(12)
    expect(toRelationId(payload('number'), 'users', 'abc')).toBe('abc')
    expect(toRelationId(payload('number'), 'users', '012')).toBe('012')
    expect(toRelationId(payload('text'), 'users', '665f1c2a')).toBe('665f1c2a')
    expect(toRelationId(payload('number', { users: 'text' }), 'users', '12')).toBe('12')
    expect(toRelationId(payload('number'), 'users', '')).toBe('')
    expect(toRelationId(payload('number'), 'users', undefined)).toBeUndefined()
  })

  it('recognises unique violations from every adapter', () => {
    expect(isDuplicateKeyError(new Error('E11000 duplicate key error collection'))).toBe(true)
    expect(
      isDuplicateKeyError(new Error('UNIQUE constraint failed: notification_events.event_id')),
    ).toBe(true)
    const drizzle = Object.assign(new Error('The following field is invalid: eventId'), {
      data: { errors: [{ message: 'Value must be unique', path: 'eventId' }] },
    })
    expect(isDuplicateKeyError(drizzle)).toBe(true)
    expect(isDuplicateKeyError(new Error('The following field is invalid: email'))).toBe(false)
  })
})
