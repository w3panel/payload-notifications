import { describe, expect, it } from 'bun:test'
import { effectiveTriggerFor, validateAdminTrigger } from '../src/admin-triggers/validate'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createMemoryPayload } from './helpers/memoryPayload'

const options = normalizePluginOptions({
  channels: ['email', 'inapp'],
  events: { 'order.paid': { classification: 'transactional', samplePayload: { orderId: 'o1' } } },
  data: { collections: { orders: { fields: ['total', 'customer'] } } },
  collectionEvents: { orders: { capture: ['status'] } },
  triggers: [
    {
      slug: 'order-paid',
      event: 'order.paid',
      deliveries: [{ channel: 'email', template: 'order.paid' }],
      admin: { policy: 'managed', overridable: ['deliveries'] },
    },
    {
      slug: 'locked',
      event: 'order.paid',
      deliveries: [{ channel: 'email', template: 'order.paid' }],
      admin: { policy: 'enforced' },
    },
  ],
})

const templates = [
  {
    slug: 'ops.alert',
    status: 'active',
    email: { subject: 'Alert', textBody: 'Order {{ order.total }}' },
    variables: [
      { name: 'order.total', required: true },
      { name: 'store.name', required: true },
      { name: 'payload.note', required: false },
    ],
  },
  { slug: 'draft.only', status: 'draft', email: { subject: 'Draft', textBody: 'x' } },
]

const validDoc = {
  slug: 'ops-alert',
  name: 'Ops alert',
  source: { type: 'event', event: 'order.paid' },
  data: {
    sources: [
      {
        type: 'collection',
        alias: 'order',
        collection: 'orders',
        lookup: { type: 'id', from: 'event.payload.orderId' },
        fields: ['total'],
      },
    ],
  },
  recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
  deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
}

const validate = (doc: Record<string, unknown>, opts = options) =>
  validateAdminTrigger({
    payload: createMemoryPayload({ 'notification-templates': templates }).payload,
    doc,
    options: opts,
  })

describe('validateAdminTrigger', () => {
  it('passes a complete standalone trigger', async () => {
    const report = await validate(validDoc)
    expect(report).toMatchObject({ ok: true, errors: [], warnings: [] })
    expect(report.checkedAt).toBeString()
  })

  it('requires a source, a registered event and an unused slug', async () => {
    expect((await validate({ ...validDoc, source: undefined })).errors).toEqual([
      'trigger "ops-alert": source is required',
    ])
    expect(
      (await validate({ ...validDoc, source: { type: 'event', event: 'order.refunded' } })).errors,
    ).toEqual(['trigger "ops-alert": event "order.refunded" is not a registered application event'])
    expect((await validate({ ...validDoc, source: { type: 'event', event: 'order.*' } })).ok).toBe(
      true,
    )
    expect((await validate({ ...validDoc, slug: 'order-paid' })).errors).toEqual([
      'trigger "order-paid": slug is used by a code trigger',
    ])
  })

  it('reuses data source, recipient, delivery and condition validators', async () => {
    const report = await validate({
      ...validDoc,
      conditions: { field: 'order.notes', operator: 'exists' },
      recipients: [{ type: 'static', email: 'nope', alias: 'ops' }],
      deliveries: [{ channel: 'sms', template: 'order.paid', recipient: 'customer' }],
    })
    expect(report.errors).toEqual([
      'trigger "ops-alert" recipient "ops": invalid email',
      'trigger "ops-alert": conditions (order.notes) source "order" does not load field "notes"',
      'trigger "ops-alert" deliveries[0]: recipient "customer" is not defined in recipients',
      'trigger "ops-alert" deliveries[0]: channel "sms" is not enabled in plugin channels',
    ])
  })

  it('checks template existence, active channel content and required variables', async () => {
    const report = await validate({
      ...validDoc,
      deliveries: [
        { channel: 'email', template: 'ops.alert', recipient: 'ops' },
        { channel: 'email', template: 'draft.only', recipient: 'ops' },
        { channel: 'email', template: 'missing', recipient: 'ops' },
      ],
    })
    expect(report.errors).toEqual([
      'trigger "ops-alert" deliveries[0]: template "ops.alert" requires "store.name", which this trigger\'s context does not provide',
      'trigger "ops-alert" deliveries[1]: template "draft.only" has no active email content',
      'trigger "ops-alert" deliveries[2]: template "missing" does not exist',
    ])
  })

  it('warns when no classification applies', async () => {
    const report = await validate(
      validDoc,
      normalizePluginOptions(({
	channels: ['email'],
	events: { 'order.paid': {} },
	data: { collections: { orders: { fields: ['total'] } } }
})),
    )
    expect(report.warnings).toEqual([
      'trigger "ops-alert": no classification set; deliveries are treated as transactional (no marketing consent check)',
    ])
  })

  it('validates managed overrides against the code trigger', async () => {
    const override = {
      slug: 'order-paid-custom',
      overrides: 'order-paid',
      deliveries: [{ channel: 'inapp', template: 'order.paid' }],
    }
    expect(effectiveTriggerFor(override, options).trigger?.deliveries).toEqual(override.deliveries)
    expect((await validate(override)).ok).toBe(true)

    expect((await validate({ ...override, recipients: [{ type: 'eventUser' }] })).errors).toEqual([
      'fields "recipients" are not overridable on "order-paid"',
    ])
    expect((await validate({ ...override, overrides: 'locked' })).errors).toEqual([
      'code trigger "locked" is enforced and cannot be overridden',
    ])
  })
})
