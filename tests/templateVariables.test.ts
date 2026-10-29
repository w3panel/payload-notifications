import { describe, expect, it } from 'bun:test'
import { validateAdminTrigger } from '../src/admin-triggers/validate'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { collectTriggerWarnings } from '../src/triggers'
import { templateVariablesEndpoint, validateTemplateDoc } from '../src/templates/validate'
import {
  availableVariables,
  checkTemplateVariables,
  extractTemplatePaths,
} from '../src/templates/variables'
import { createMemoryPayload } from './helpers/memoryPayload'

const options = normalizePluginOptions({
  channels: ['email'],
  events: { 'order.paid': { samplePayload: { orderId: 'o1', items: [{ sku: 'A', qty: 1 }] } } },
  data: { collections: { orders: { fields: ['total', 'customer'] } } },
  collectionEvents: { orders: { capture: ['status'] } },
  dataResolvers: { store: { handler: () => ({}), fields: ['name'] } },
})

describe('extractTemplatePaths', () => {
  it('reads variables, conditions and loops with item scope', () => {
    expect(
      extractTemplatePaths(
        'Hi {{ recipient.name }}, order {{ payload.orderId | default "?" }}{{#if order.total}} {{ order.total }}{{/if}}{{#each payload.items}}{{ sku }} x{{ qty }} {{ this.note }} {{ @index }} {{ recipient.name }}{{/each}}',
      ).sort(),
    ).toEqual([
      'order.total',
      'payload.items',
      'payload.items.0.note',
      'payload.items.0.qty',
      'payload.items.0.sku',
      'payload.orderId',
      'recipient.name',
    ])
  })
})

describe('availableVariables', () => {
  it('combines base context, sample payload, captured fields and sources', () => {
    const trigger = {
      slug: 't',
      source: { type: 'collection' as const, collection: 'orders', operation: 'update' as const },
      data: {
        sources: [
          {
            type: 'collection' as const,
            alias: 'order',
            collection: 'orders',
            lookup: { type: 'id' as const, from: 'doc.id' },
            fields: ['total'],
          },
          { type: 'resolver' as const, alias: 'shop', name: 'store' },
        ],
      },
      deliveries: [],
    }
    const available = availableVariables(options, { trigger })
    expect(available.paths).toContain('doc.status')
    expect(available.paths).toContain('order.total')
    expect(available.paths).toContain('shop.name')
    expect(available.paths).toContain('recipient.name')

    const forEvent = availableVariables(options, { event: 'order.paid' })
    expect(forEvent.paths).toContain('payload.items.0.sku')
  })

  it('reports unknown and missing required variables', () => {
    const available = availableVariables(options, { event: 'order.paid' })
    expect(
      checkTemplateVariables(
        ['{{ payload.orderId }} {{ payload.coupon }} {{ customer.name }} {{ trigger.eventId }}'],
        available,
        [
          { name: 'payload.orderId', required: true },
          { name: 'store.name', required: true },
        ],
      ),
    ).toEqual({ unknown: ['customer.name', 'payload.coupon'], missingRequired: ['store.name'] })

    // Unknown payload shape: any payload field is accepted
    expect(
      checkTemplateVariables(['{{ payload.anything }}'], availableVariables(options)).unknown,
    ).toEqual([])
  })
})

describe('template publish validation', () => {
  const memory = createMemoryPayload()

  it('rejects templates that do not compile', async () => {
    const report = await validateTemplateDoc(memory.payload, options, {
      slug: 'misc',
      channels: ['email'],
      email: { subject: '{{#if x}}', textBody: 'ok' },
    })
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toStartWith('email:')
  })

  it('checks variables against the event the slug names', async () => {
    const report = await validateTemplateDoc(memory.payload, options, {
      slug: 'order.paid',
      channels: ['email'],
      email: { subject: 'Order {{ payload.orderId }}', textBody: '{{ payload.coupon }}' },
      variables: [{ name: 'store.name', required: true }],
    })
    expect(report).toEqual({
      errors: ['required variable "store.name" is not provided by event "order.paid"'],
      warnings: ['"payload.coupon" is not provided by event "order.paid"'],
    })
  })

  it('serves variables for editors', async () => {
    const endpoint = templateVariablesEndpoint(() => options)
    const res = await endpoint.handler({
      user: { id: 'a' },
      url: 'http://x/api/notification-templates/variables?event=order.paid',
    } as never)
    expect((await res.json()).variables).toContain('payload.orderId')
    expect((await endpoint.handler({ user: null, url: 'http://x' } as never)).status).toBe(401)
  })
})

describe('trigger variable warnings', () => {
  it('warns when a code trigger template uses variables the trigger does not provide', () => {
    const withTrigger = normalizePluginOptions({
      channels: ['email'],
      events: { 'order.paid': { samplePayload: { orderId: 'o1' } } },
      templates: {
        registry: {
          receipt: {
            email: { subject: 'Order {{ payload.orderId }}', body: 'Hi {{ customer.name }}' },
          },
        },
      },
      triggers: [
        {
          slug: 'receipt',
          event: 'order.paid',
          deliveries: [{ channel: 'email', template: 'receipt' }],
        },
      ],
    })
    expect(collectTriggerWarnings(withTrigger)).toEqual([
      'trigger "receipt" deliveries[0]: template "receipt" uses "customer.name", which this trigger does not provide',
    ])
  })

  it('adds unknown-variable warnings to admin trigger validation', async () => {
    const memory = createMemoryPayload({
      'notification-templates': [
        {
          slug: 'ops',
          status: 'active',
          channels: ['email'],
          email: { subject: 'x', textBody: '{{ order.missing }}' },
        },
      ],
    })
    const report = await validateAdminTrigger({
      payload: memory.payload,
      options,
      doc: {
        slug: 'ops-alert',
        source: { type: 'event', event: 'order.paid' },
        classification: 'transactional',
        recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
        deliveries: [{ channel: 'email', template: 'ops', recipient: 'ops' }],
      },
    })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([
      'trigger "ops-alert" deliveries[0]: template "ops" uses "order.missing", which this trigger does not provide',
    ])
  })
})
