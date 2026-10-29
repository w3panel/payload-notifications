import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { NotificationCondition } from '../src/types'
import {
  addNode,
  BUILDER_STEPS,
  cleanCondition,
  EMPTY_REGISTRY,
  newRule,
  operatorsFor,
  parseConditionValue,
  recipientAliases,
  removeNode,
  replaceNode,
  sampleFor,
  suggestFields,
  templatesForChannel,
  toEditableGroup,
  toggleGroupType,
  type BuilderRegistry,
} from '../src/admin/triggerBuilderModel'

const setValue = mock(() => undefined)
mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData: () => ({}) }),
  useField: ({ path }: { path: string }) => ({
    value: path === 'source' ? { type: 'event', event: 'order.paid' } : undefined,
    setValue,
  }),
  useDocumentInfo: () => ({ id: 't1' }),
  useFormModified: () => false,
}))

const registry: BuilderRegistry = {
  ...EMPTY_REGISTRY,
  channels: ['email', 'inapp'],
  events: [
    {
      name: 'order.paid',
      label: 'Order paid',
      fields: ['orderId', 'total'],
      samplePayload: { orderId: 'o1' },
    },
    { name: 'order.shipped', label: 'Order shipped', fields: ['trackingNumber'] },
  ],
  collections: [{ slug: 'orders', label: 'Orders', fields: ['total', 'customer'] }],
  collectionEvents: [
    { slug: 'orders', label: 'Orders', operations: ['update'], capture: ['status'] },
  ],
  resolvers: [{ name: 'storeDetails', label: 'Store', fields: ['name'] }],
  conditions: [{ name: 'isVip', label: 'VIP' }],
  operators: ['equals', 'in', 'exists', 'greaterThan', 'changed', 'changedTo'],
  recipientTypes: ['eventUser', 'context', 'static'],
  templates: [
    { slug: 'order.paid', source: 'code', status: 'active', channels: ['email', 'inapp'] },
    { slug: 'ops.alert', source: 'db', status: 'active', channels: ['email'] },
  ],
}

describe('condition tree editing', () => {
  it('adds, replaces and removes nodes in nested groups', () => {
    let tree = toEditableGroup(undefined)
    tree = addNode(tree, [], newRule('event.payload.total', 'greaterThan'))
    tree = addNode(tree, [], { any: [] })
    tree = addNode(tree, [1], newRule('order.status', 'equals'))
    tree = replaceNode(tree, [1, 0], { field: 'order.status', operator: 'in', value: ['paid'] })
    expect(tree).toEqual({
      all: [
        { field: 'event.payload.total', operator: 'greaterThan', value: '' },
        { any: [{ field: 'order.status', operator: 'in', value: ['paid'] }] },
      ],
    })
    expect(removeNode(tree, [1, 0])).toEqual({ all: [tree.all[0], { any: [] }] })
    expect(toggleGroupType(tree)).toEqual({ any: tree.all })
  })

  it('wraps single rules and cleans empty groups on save', () => {
    const rule: NotificationCondition = { field: 'payload.x', operator: 'exists' }
    expect(toEditableGroup(rule)).toEqual({ all: [rule] })
    expect(cleanCondition({ all: [{ any: [] }, rule, { not: { all: [] } }] })).toEqual({
      all: [rule],
    })
    expect(cleanCondition({ all: [] })).toBeUndefined()
  })

  it('offers change operators only for doc fields of collection triggers', () => {
    expect(operatorsFor('doc.status', registry.operators, true)).toContain('changedTo')
    expect(operatorsFor('order.status', registry.operators, true)).not.toContain('changedTo')
    expect(operatorsFor('doc.status', registry.operators, false)).not.toContain('changed')
  })

  it('parses values for operators', () => {
    expect(parseConditionValue('in', 'paid, 2, true')).toEqual(['paid', 2, true])
    expect(parseConditionValue('greaterThan', '5000')).toBe(5000)
    expect(parseConditionValue('equals', 'paid')).toBe('paid')
    expect(parseConditionValue('exists', 'false')).toBe(false)
    expect(parseConditionValue('exists', '')).toBeUndefined()
  })
})

describe('builder pickers', () => {
  it('suggests event, doc, alias and recipient fields', () => {
    const data = {
      sources: [
        {
          type: 'collection' as const,
          alias: 'order',
          collection: 'orders',
          lookup: { type: 'id' as const, from: 'event.payload.orderId' },
          fields: ['total'],
        },
        { type: 'resolver' as const, alias: 'store', name: 'storeDetails' },
      ],
    }
    expect(suggestFields(registry, { source: { type: 'event', event: 'order.*' }, data })).toEqual([
      'event.payload.orderId',
      'event.payload.total',
      'event.payload.trackingNumber',
      'order.id',
      'order.total',
      'store.name',
    ])
    expect(
      suggestFields(
        registry,
        { source: { type: 'collection', collection: 'orders', operation: 'update' } },
        { recipient: true },
      ),
    ).toEqual([
      'doc.status',
      'previous.status',
      'recipient.id',
      'recipient.name',
      'recipient.email',
      'recipient.locale',
    ])
  })

  it('filters templates by channel and lists recipient aliases', () => {
    expect(templatesForChannel(registry, 'inapp').map((t) => t.slug)).toEqual(['order.paid'])
    expect(recipientAliases(undefined)).toEqual(['all', 'user'])
    expect(
      recipientAliases([
        { type: 'static', email: 'a@b.co', alias: 'ops' },
        { type: 'role', role: 'x' },
      ]),
    ).toEqual(['all', 'ops', 'recipient1'])
    expect(sampleFor(registry, { type: 'event', event: 'order.paid' })).toBe(
      '{\n  "orderId": "o1"\n}',
    )
  })
})

describe('TriggerBuilder components', () => {
  const fields = () => ({
    source: [{ type: 'event', event: 'order.paid' }, setValue] as never,
    conditions: [
      { all: [{ field: 'event.payload.total', operator: 'greaterThan', value: 5000 }] },
      setValue,
    ] as never,
    data: [undefined, setValue] as never,
    recipients: [[{ type: 'static', email: 'ops@example.com', alias: 'ops' }], setValue] as never,
    deliveries: [
      [{ channel: 'email', template: 'ops.alert', recipient: 'ops' }],
      setValue,
    ] as never,
    schedule: [
      { type: 'relative', at: 'booking.startsAt', offset: '-24h', recheckConditions: true },
      setValue,
    ] as never,
    classification: [undefined, setValue] as never,
    overrides: [undefined, setValue] as never,
  })

  it('renders every step', async () => {
    const { TriggerBuilderInner } = await import('../src/admin/TriggerBuilderField')
    const expectations: Record<string, string> = {
      source: 'Order paid (order.paid)',
      conditions: 'ALL of (AND)',
      data: '+ Add…',
      recipients: 'ops@example.com',
      deliveries: 'ops.alert (active)',
      schedule: 'Re-check conditions when due',
      test: 'Send test to me',
    }
    for (const step of BUILDER_STEPS) {
      const html = renderToString(
        <TriggerBuilderInner
          registry={registry}
          getDoc={() => ({})}
          apiRoute="/api"
          collectionSlug="notification-triggers"
          initialStep={step.key}
          fields={fields()}
        />,
      )
      // React SSR separates adjacent text nodes with <!-- --> markers
      expect(html.replaceAll('<!-- -->', '')).toContain(expectations[step.key])
    }
  })

  it('explains managed overrides on the source step', async () => {
    const { TriggerBuilderInner } = await import('../src/admin/TriggerBuilderField')
    const html = renderToString(
      <TriggerBuilderInner
        registry={registry}
        getDoc={() => ({})}
        apiRoute="/api"
        collectionSlug="notification-triggers"
        fields={{ ...fields(), overrides: ['order-paid', setValue] as never }}
      />,
    )
    expect(html).toContain('customizes the code trigger')
  })

  it('mounts as a Payload field without reading form data up front', async () => {
    const { TriggerBuilderField } = await import('../src/admin/TriggerBuilderField')
    const html = renderToString(<TriggerBuilderField path="builder" />)
    expect(html).toContain('Trigger builder')
    expect(setValue).not.toHaveBeenCalled()
  })

  it('renders the code trigger table with policies and actions', async () => {
    const { CodeTriggersTable } = await import('../src/admin/CodeTriggersList')
    const html = renderToString(
      <CodeTriggersTable
        onCustomize={() => undefined}
        editHref={(id) => `/admin/collections/notification-triggers/${id}`}
        triggers={[
          {
            slug: 'managed',
            origin: 'code',
            source: { type: 'event', event: 'order.paid' },
            enabled: true,
            policy: 'managed',
            overridable: ['deliveries'],
            deliveries: [{ channel: 'email', template: 'order.paid' }],
            override: null,
          },
          {
            slug: 'locked',
            origin: 'code',
            source: { type: 'event', event: 'order.paid' },
            enabled: true,
            policy: 'enforced',
            overridable: [],
            deliveries: [],
            override: null,
          },
          {
            slug: 'custom',
            origin: 'rule',
            source: { type: 'collection', collection: 'orders', operation: 'update' },
            enabled: false,
            policy: 'managed',
            overridable: [],
            deliveries: [],
            override: { id: 'x1', slug: 'custom-custom', status: 'draft' },
          },
        ]}
      />,
    )
    expect(html).toContain('Customize')
    expect(html).toContain('🔒 Enforced')
    expect(html).toContain('/admin/collections/notification-triggers/x1')
    expect(html).toContain('legacy rule')
    expect(html).toContain('orders · update')
  })
})
