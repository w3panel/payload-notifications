import { describe, expect, it } from 'bun:test'
import type { Field } from 'payload'
import { definitionOf, sameDefinition, toAdminTriggerRecord } from '../src/admin-triggers/record'
import {
  NotificationTriggersCollection,
  trackDefinitionChanges,
} from '../src/collections/NotificationTriggers'
import { NotificationTriggerVersionsCollection } from '../src/collections/NotificationTriggerVersions'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

type Doc = Record<string, unknown>

const flatten = (fields: Field[]): Field[] =>
  fields.flatMap((field) =>
    'fields' in field && !('name' in field) ? flatten(field.fields) : [field],
  )

describe('notification-triggers collection', () => {
  const isAdmin = ({ req }: { req: { user?: Doc | null } }) => req.user?.role === 'admin'
  const collection = NotificationTriggersCollection({
    getOptions: () => normalizePluginOptions({ access: { isAdmin: isAdmin as never } }),
  })
  const field = (name: string) =>
    flatten(collection.fields).find((entry) => 'name' in entry && entry.name === name) as Field & {
      access?: { update?: () => boolean; create?: () => boolean }
      validate?: (value: unknown) => true | string
    }

  it('lets only trigger managers write and any user read', async () => {
    const access = collection.access as Record<string, (args: unknown) => unknown>
    const editor = { req: { user: { id: 'e', role: 'editor' } } }
    const admin = { req: { user: { id: 'a', role: 'admin' } } }
    expect(await access.create(editor)).toBe(false)
    expect(await access.update(admin)).toBe(true)
    expect(access.read(editor)).toBe(true)
    expect(access.read({ req: { user: null } })).toBe(false)
  })

  it('keeps lifecycle fields server-managed', () => {
    for (const name of [
      'status',
      'version',
      'hasUnpublishedChanges',
      'publishedAt',
      'publishedBy',
      'validation',
    ]) {
      expect(field(name).access?.update?.()).toBe(false)
      expect(field(name).access?.create?.()).toBe(false)
    }
    expect(field('slug')).toMatchObject({ unique: true })
  })

  it('validates JSON definition shapes', () => {
    expect(field('deliveries').validate?.([])).toBe(true)
    expect(field('deliveries').validate?.({})).toBe('deliveries must be a JSON array')
    expect(field('source').validate?.([])).toBe('source must be a JSON object')
    expect(field('source').validate?.(undefined)).toBe(true)
  })

  it('mounts the builder and the code trigger list', () => {
    expect(field('builder')).toMatchObject({
      type: 'ui',
      admin: { components: { Field: '@wtree/payload-notifications/admin#TriggerBuilderField' } },
    })
    expect(collection.admin?.components?.beforeList).toEqual([
      '@wtree/payload-notifications/admin#CodeTriggersList',
    ])
  })

  it('stores immutable versions', () => {
    const versions = NotificationTriggerVersionsCollection()
    const access = versions.access as Record<string, () => boolean>
    expect(access.create()).toBe(false)
    expect(access.update()).toBe(false)
    expect(access.delete()).toBe(false)
  })
})

describe('definition tracking', () => {
  const published = {
    status: 'published',
    source: { type: 'event', event: 'order.paid' },
    deliveries: [{ channel: 'email', template: 'x' }],
  }
  const hook = (data: Doc, originalDoc: Doc) =>
    trackDefinitionChanges({ data, originalDoc, operation: 'update' } as never)

  it('flags unpublished changes on published triggers without touching the snapshot', () => {
    expect(hook({ deliveries: [{ channel: 'inapp', template: 'x' }] }, published)).toEqual({
      deliveries: [{ channel: 'inapp', template: 'x' }],
      hasUnpublishedChanges: true,
    })
    // Non-definition edits (name, description) are not unpublished changes
    expect(hook({ name: 'Renamed' }, published)).toEqual({ name: 'Renamed' })
  })

  it('sends edited validated triggers back to draft', () => {
    expect(
      hook(
        { conditions: { field: 'payload.x', operator: 'exists' } },
        { ...published, status: 'validated' },
      ),
    ).toMatchObject({
      status: 'draft',
      validation: null,
    })
  })

  it('compares definitions independent of key order', () => {
    expect(
      sameDefinition(
        definitionOf({ source: { a: 1, b: 2 } }),
        definitionOf({ source: { b: 2, a: 1 } }),
      ),
    ).toBe(true)
    expect(definitionOf({ source: { type: 'event' }, name: 'x', overrides: '' })).toEqual({
      source: { type: 'event' },
    })
  })
})

describe('toAdminTriggerRecord', () => {
  it('keeps full definitions for standalone triggers', () => {
    expect(
      toAdminTriggerRecord(
        'ops',
        2,
        {
          source: { type: 'event', event: 'order.paid' },
          deliveries: [{ channel: 'email', template: 'x' }],
          classification: 'transactional',
        },
        'Ops alert',
      ),
    ).toEqual({
      slug: 'ops',
      version: 2,
      name: 'Ops alert',
      source: { type: 'event', event: 'order.paid' },
      deliveries: [{ channel: 'email', template: 'x' }],
      classification: 'transactional',
    })
  })

  it('keeps only overridable fields for managed overrides', () => {
    expect(
      toAdminTriggerRecord('custom', 1, {
        overrides: 'order-paid',
        source: { type: 'event', event: 'other' },
        classification: 'marketing',
        deliveries: [{ channel: 'inapp', template: 'x' }],
        conditions: { field: 'payload.total', operator: 'exists' },
      }),
    ).toEqual({
      slug: 'custom',
      version: 1,
      overrides: 'order-paid',
      deliveries: [{ channel: 'inapp', template: 'x' }],
      conditions: { field: 'payload.total', operator: 'exists' },
    })
  })
})
