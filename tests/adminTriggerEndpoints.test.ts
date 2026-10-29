import { describe, expect, it } from 'bun:test'
import {
  codeTriggersEndpoint,
  customizeCodeTriggerEndpoint,
  triggerRegistryEndpoint,
  triggerTestEndpoint,
} from '../src/admin-triggers/endpoints'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createTemplateTestSendHandler } from '../src/endpoints/templateTestSend'
import { REDACTED } from '../src/data/sensitive'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  events: {
    'order.paid': { classification: 'transactional', samplePayload: { orderId: 'ORD-1' } },
  },
  data: {
    collections: {
      orders: { fields: ['total', 'customer', 'status'] },
      users: { fields: ['name', 'email', 'phone'] },
    },
    redact: ['customer.phone'],
  },
  collectionEvents: { orders: { capture: ['status', 'total'], userField: 'customer' } },
  conditions: { always: { label: 'Always', handler: () => true } },
  templates: {
    registry: {
      'ops.alert': {
        email: {
          subject: 'Order {{ order.id }}',
          body: 'Customer {{ customer.name }} {{ customer.phone }}',
        },
        inapp: { title: 'Order', body: 'Order {{ order.id }}' },
      },
    },
  },
  triggers: [
    {
      slug: 'managed',
      event: 'order.paid',
      deliveries: [{ channel: 'email', template: 'ops.alert' }],
      admin: { policy: 'managed', overridable: ['deliveries', 'conditions'] },
      conditions: { field: 'payload.orderId', operator: 'exists' },
    },
    {
      slug: 'locked',
      event: 'order.paid',
      deliveries: [{ channel: 'email', template: 'ops.alert' }],
      admin: { policy: 'enforced' },
    },
  ],
  rules: [{ event: 'order.shipped', channels: ['email'], template: 'order.shipped' }],
}

const seed = () => ({
  users: [
    { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin' },
    { id: 'u1', name: 'Alex', email: 'alex@example.com', phone: '+919876543210' },
  ],
  orders: [{ id: 'ORD-1', total: 2499, customer: 'u1', status: 'paid' }],
  'notification-templates': [
    { slug: 'db.template', status: 'draft', inapp: { title: 'T', body: 'B' } },
  ],
})

const call = async (
  endpoint: { handler: (req: never) => Promise<Response> | Response },
  {
    user = { id: 'admin', role: 'admin' } as Doc | null,
    body = {} as Doc,
    routeParams = {} as Doc,
    memory = createMemoryPayload(seed()),
  } = {},
) => {
  const res = await endpoint.handler({
    user,
    payload: memory.payload,
    routeParams,
    json: async () => body,
  } as never)
  return { res, body: (await res.json()) as Doc, memory }
}

const options = normalizePluginOptions(pluginOptions)

describe('registry endpoint', () => {
  it('lists pickers for the builder', async () => {
    const { res, body } = await call(triggerRegistryEndpoint(() => options))
    expect(res.status).toBe(200)
    expect(body.events).toEqual([
      expect.objectContaining({ name: 'order.paid', fields: ['orderId'] }),
    ])
    expect(body.collectionEvents).toEqual([
      {
        slug: 'orders',
        label: 'orders',
        operations: ['create', 'update'],
        capture: ['status', 'total'],
      },
    ])
    expect(body.conditions).toEqual([{ name: 'always', label: 'Always' }])
    expect((body.operators as string[]).length).toBe(13)
    const templates = body.templates as Array<Doc>
    expect(templates).toContainEqual({
      slug: 'ops.alert',
      source: 'code',
      status: 'active',
      channels: ['email', 'inapp'],
    })
    expect(templates).toContainEqual({
      slug: 'db.template',
      source: 'db',
      status: 'draft',
      channels: ['inapp'],
    })
  })

  it('requires manageTriggers', async () => {
    expect(
      (
        await call(
          triggerRegistryEndpoint(() => options),
          { user: null },
        )
      ).res.status,
    ).toBe(401)
    const restricted = normalizePluginOptions({
      ...pluginOptions,
      access: { isAdmin: ({ req }) => (req.user as Doc | null)?.role === 'admin' },
    })
    expect(
      (
        await call(
          triggerRegistryEndpoint(() => restricted),
          { user: { id: 'e', role: 'editor' } },
        )
      ).res.status,
    ).toBe(403)
  })
})

describe('code triggers', () => {
  it('lists code triggers with policy, overridable fields and overrides', async () => {
    const memory = createMemoryPayload({
      ...seed(),
      'notification-triggers': [
        { id: 'x', slug: 'managed-custom', overrides: 'managed', status: 'draft' },
      ],
    })
    const { body } = await call(
      codeTriggersEndpoint(() => options),
      { memory },
    )
    const triggers = body.triggers as Array<Doc>
    expect(triggers.map((trigger) => [trigger.slug, trigger.origin, trigger.policy])).toEqual([
      ['rule-0-order.shipped', 'rule', 'independent'],
      ['managed', 'code', 'managed'],
      ['locked', 'code', 'enforced'],
    ])
    expect(triggers[1]).toMatchObject({
      overridable: ['deliveries', 'conditions'],
      hasConditions: true,
      override: { id: 'x', slug: 'managed-custom', status: 'draft' },
    })
    expect(triggers[2]).toMatchObject({ overridable: [], override: null })
  })

  it('customizes managed triggers into a draft override with their overridable fields', async () => {
    const endpoint = customizeCodeTriggerEndpoint(() => options)
    const memory = createMemoryPayload(seed())
    const first = await call(endpoint, { memory, routeParams: { slug: 'managed' } })
    expect(first.res.status).toBe(201)
    expect(memory.docs('notification-triggers')[0]).toMatchObject({
      name: 'managed (customized)',
      slug: 'managed-custom',
      overrides: 'managed',
      deliveries: [{ channel: 'email', template: 'ops.alert' }],
      conditions: { field: 'payload.orderId', operator: 'exists' },
    })
    expect(memory.docs('notification-triggers')[0]).not.toHaveProperty('recipients')

    const again = await call(endpoint, { memory, routeParams: { slug: 'managed' } })
    expect(again.res.status).toBe(409)
    expect(again.body.id).toBe(first.body.id)

    expect((await call(endpoint, { routeParams: { slug: 'locked' } })).res.status).toBe(409)
    expect((await call(endpoint, { routeParams: { slug: 'nope' } })).res.status).toBe(404)
  })
})

const testDoc = {
  slug: 'ops-alert',
  version: 2,
  source: { type: 'event', event: 'order.paid' },
  data: {
    sources: [
      {
        type: 'collection',
        alias: 'order',
        collection: 'orders',
        lookup: { type: 'id', from: 'event.payload.orderId' },
        fields: ['total', 'customer'],
      },
      {
        type: 'collection',
        alias: 'customer',
        collection: 'users',
        lookup: { type: 'relationship', from: 'order.customer' },
        fields: ['name', 'phone'],
      },
    ],
  },
  recipients: [
    { type: 'context', path: 'customer.id', alias: 'customer' },
    { type: 'static', email: 'ops@example.com', alias: 'ops' },
  ],
  deliveries: [
    { channel: 'email', template: 'ops.alert', recipient: 'all' },
    { channel: 'inapp', template: 'ops.alert', recipient: 'customer' },
  ],
}

describe('trigger test runner', () => {
  const endpoint = triggerTestEndpoint(() => options)

  it('dry-runs with the registered sample payload and redacts previews', async () => {
    const { res, body, memory } = await call(endpoint, { body: { doc: testDoc } })
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      matched: true,
      event: { name: 'order.paid', payload: { orderId: 'ORD-1' } },
    })
    expect((body.context as Doc).customer).toEqual({ id: 'u1', name: 'Alex', phone: REDACTED })
    expect(body.recipients).toEqual([
      {
        key: 'user:u1',
        aliases: ['customer'],
        name: 'Alex',
        destinations: {
          email: 'a***@example.com',
          sms: '+91******3210',
          whatsapp: '+91******3210',
          inapp: '***',
        },
      },
      {
        key: 'email:ops@example.com',
        aliases: ['ops'],
        destinations: { email: 'o***@example.com' },
      },
    ])
    const deliveries = body.deliveries as Array<Doc>
    expect(deliveries.map((d) => [d.channel, d.recipientKey])).toEqual([
      ['email', 'user:u1'],
      ['email', 'email:ops@example.com'],
      ['inapp', 'user:u1'],
    ])
    expect(deliveries[0].rendered).toMatchObject({
      subject: 'Order ORD-1',
      text: `Customer Alex ${REDACTED}`,
    })
    // Dry runs write nothing
    expect(memory.docs('notification-deliveries')).toHaveLength(0)
    expect(memory.sendEmail).toHaveBeenCalledTimes(0)
  })

  it('reports conditions that do not match and invalid definitions', async () => {
    const notMatched = await call(endpoint, {
      body: {
        doc: {
          ...testDoc,
          conditions: { field: 'payload.orderId', operator: 'equals', value: 'other' },
        },
      },
    })
    expect(notMatched.body).toMatchObject({
      matched: false,
      outcome: 'not-matched',
      reason: 'conditions did not match',
    })

    const invalid = await call(endpoint, { body: { doc: { slug: 'x', deliveries: [] } } })
    expect(invalid.res.status).toBe(400)
    expect(invalid.body.errors).toEqual(['trigger "x": source is required'])
  })

  it('tests collection triggers against a real document', async () => {
    const { body } = await call(endpoint, {
      body: {
        doc: {
          slug: 'status-paid',
          source: { type: 'collection', collection: 'orders', operation: 'update' },
          conditions: { field: 'doc.status', operator: 'changedTo', value: 'paid' },
          deliveries: [{ channel: 'inapp', template: 'ops.alert' }],
        },
        documentId: 'ORD-1',
        sampleEvent: { previous: { status: 'pending' } },
      },
    })
    expect(body).toMatchObject({ matched: true, event: { name: 'collection.orders.update' } })
    expect((body.recipients as Array<Doc>)[0].key).toBe('user:u1')

    const missing = await call(endpoint, {
      body: {
        doc: {
          slug: 's',
          source: { type: 'collection', collection: 'orders', operation: 'update' },
          deliveries: [{ channel: 'inapp', template: 'ops.alert' }],
        },
      },
    })
    expect(missing.res.status).toBe(400)
  })

  it('test-sends each channel once to the current admin only', async () => {
    const { body, memory } = await call(endpoint, { body: { doc: testDoc, send: true } })
    const sent = body.sent as Array<Doc>
    expect(sent.map((item) => [item.channel, item.status])).toEqual([
      ['email', 'sent'],
      ['inapp', 'stored'],
    ])
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
    expect((memory.sendEmail.mock.calls[0][0] as unknown as Doc).to).toBe('admin@example.com')
    // In-app goes to the admin, never to the customer
    expect(memory.docs('notifications').map((n) => n.recipient)).toEqual(['admin'])
    const deliveries = memory.docs('notification-deliveries')
    expect(
      deliveries.every(
        (delivery) =>
          delivery.test === true && String(delivery.idempotencyKey).startsWith('test::'),
      ),
    ).toBe(true)
  })

  it('requires testSend permission to send', async () => {
    const restricted = normalizePluginOptions({
      ...pluginOptions,
      access: { testSend: () => false },
    })
    const res = await call(
      triggerTestEndpoint(() => restricted),
      { body: { doc: testDoc, send: true } },
    )
    expect(res.res.status).toBe(403)
    const dry = await call(
      triggerTestEndpoint(() => restricted),
      { body: { doc: testDoc } },
    )
    expect(dry.res.status).toBe(200)

    const templateSend = createTemplateTestSendHandler(() => restricted)
    const templateRes = await templateSend({ user: { id: 'a' }, json: async () => ({}) } as never)
    expect(templateRes.status).toBe(403)
  })
})
