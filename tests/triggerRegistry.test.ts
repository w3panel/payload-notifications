import { describe, expect, it } from 'bun:test'
import {
  defineTrigger,
  eventMatchesPattern,
  matchTriggers,
  resolveEffectiveTriggers,
  snapshotTrigger,
} from '../src/triggers'
import type { NotificationTrigger } from '../src/types'

const code = (slug: string, policy?: 'independent' | 'managed' | 'enforced', extra = {}) =>
  defineTrigger({
    slug,
    event: 'order.paid',
    deliveries: [{ channel: 'email', template: 'order.paid' }],
    ...(policy ? { admin: { policy } } : {}),
    ...extra,
  }) as NotificationTrigger

const adminStandalone = {
  slug: 'order-paid-ops',
  version: 2,
  source: { type: 'event' as const, event: 'order.paid' },
  recipients: [{ type: 'static' as const, email: 'ops@example.com' }],
  deliveries: [{ channel: 'email' as const, template: 'ops.order-paid' }],
}

describe('resolveEffectiveTriggers', () => {
  it('runs independent code triggers alongside standalone admin triggers', () => {
    const { triggers, errors } = resolveEffectiveTriggers([code('order-paid')], [adminStandalone])
    expect(errors).toEqual([])
    expect(triggers.map(snapshotTrigger)).toEqual([
      { slug: 'order-paid', origin: 'code', version: 1, policy: 'independent' },
      { slug: 'order-paid-ops', origin: 'admin', version: 2, policy: 'admin' },
    ])
    expect(triggers[1].trigger.enabled).toBe(true)
  })

  it('lets a managed override replace only overridable fields', () => {
    const target = code('order-paid', 'managed', {
      admin: { policy: 'managed', overridable: ['deliveries', 'enabled'] },
    })
    const { triggers, errors } = resolveEffectiveTriggers(
      [target],
      [
        {
          slug: 'order-paid-custom',
          version: 3,
          overrides: 'order-paid',
          deliveries: [{ channel: 'inapp', template: 'order.paid' }],
        },
      ],
    )
    expect(errors).toEqual([])
    expect(triggers).toHaveLength(1)
    expect(snapshotTrigger(triggers[0])).toEqual({
      slug: 'order-paid',
      origin: 'admin',
      version: 3,
      policy: 'managed',
      overrideOf: 'order-paid',
    })
    expect(triggers[0].trigger.deliveries).toEqual([{ channel: 'inapp', template: 'order.paid' }])
    // Non-overridden fields still come from code
    expect(triggers[0].trigger.source).toEqual(target.source)
  })

  it('rejects overriding a non-overridable field', () => {
    const target = code('order-paid', 'managed', {
      admin: { policy: 'managed', overridable: ['enabled'] },
    })
    const { triggers, errors } = resolveEffectiveTriggers(
      [target],
      [
        {
          slug: 'x',
          version: 1,
          overrides: 'order-paid',
          enabled: false,
          recipients: [{ type: 'static', email: 'a@b.co' }],
        },
      ],
    )
    expect(errors).toEqual([
      'admin trigger "x": fields "recipients" are not overridable on "order-paid"',
    ])
    expect(triggers[0].origin).toBe('code')
    expect(triggers[0].trigger.enabled).toBe(true)
  })

  it('rejects overrides of independent and enforced triggers', () => {
    const { errors } = resolveEffectiveTriggers(
      [code('a'), code('b', 'enforced')],
      [
        { slug: 'x', version: 1, overrides: 'a', enabled: false },
        { slug: 'y', version: 1, overrides: 'b', enabled: false },
        { slug: 'z', version: 1, overrides: 'missing', enabled: false },
      ],
    )
    expect(errors).toEqual([
      'admin trigger "x": code trigger "a" is independent and cannot be overridden',
      'admin trigger "y": code trigger "b" is enforced and cannot be overridden',
      'admin trigger "z": overrides unknown code trigger "missing"',
    ])
  })

  it('rejects slug collisions, duplicate overrides and invalid admin shapes', () => {
    const { triggers, errors } = resolveEffectiveTriggers(
      [code('order-paid', 'managed')],
      [
        { ...adminStandalone, slug: 'order-paid' },
        { slug: 'm1', version: 1, overrides: 'order-paid', enabled: false },
        { slug: 'm2', version: 1, overrides: 'order-paid', enabled: true },
        { slug: 'broken', version: 1, source: { type: 'event', event: 'a.b' }, deliveries: [] },
        { ...adminStandalone, slug: 'dup' },
        { ...adminStandalone, slug: 'dup' },
      ],
    )
    expect(errors).toEqual([
      'admin trigger "order-paid": slug is used by a code trigger (set overrides to manage a managed trigger)',
      'admin trigger "m2": code trigger "order-paid" already has a managed override',
      'admin trigger "broken": trigger "broken": at least one delivery is required',
      'admin trigger "dup": duplicate slug',
    ])
    expect(triggers.map((entry) => entry.trigger.slug)).toEqual(['order-paid', 'dup'])
  })
})

describe('matchTriggers', () => {
  const entries = resolveEffectiveTriggers([
    code('exact'),
    code('wildcard', undefined, { event: 'order.*' }),
    code('all', undefined, { event: '*' }),
    code('other', undefined, { event: 'user.created' }),
    code('disabled', undefined, { enabled: false }),
    defineTrigger({
      slug: 'orders-updated',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      deliveries: [{ channel: 'email', template: 't' }],
    }),
  ]).triggers

  it('matches exact names, trailing wildcards and *', () => {
    expect(eventMatchesPattern('order.paid', 'order.*')).toBe(true)
    expect(eventMatchesPattern('orders.paid', 'order.*')).toBe(false)
    expect(eventMatchesPattern('order', 'order.*')).toBe(false)
    expect(
      matchTriggers(entries, { type: 'event', name: 'order.paid' }).map((e) => e.trigger.slug),
    ).toEqual(['exact', 'wildcard', 'all'])
  })

  it('matches collection sources by collection and operation', () => {
    expect(
      matchTriggers(entries, { type: 'collection', collection: 'orders', operation: 'update' }).map(
        (e) => e.trigger.slug,
      ),
    ).toEqual(['orders-updated'])
    expect(
      matchTriggers(entries, { type: 'collection', collection: 'orders', operation: 'create' }),
    ).toEqual([])
  })
})
