/**
 * Reference workflow: order.paid → customer email + WhatsApp + in-app, with
 * order, customer and store data loaded by data sources.
 *
 * Used by tests/orderPaidWorkflow.test.ts; copy it into a Payload app as a
 * starting point.
 */
import type { CollectionConfig } from 'payload'
import type { NotificationsPluginOptions } from '../../src'
import { defineTrigger } from '../../src'

export const collections: CollectionConfig[] = [
  {
    slug: 'users',
    auth: true,
    fields: [
      { name: 'name', type: 'text' },
      { name: 'phone', type: 'text' },
    ],
  },
  {
    slug: 'stores',
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'supportEmail', type: 'email' },
    ],
  },
  {
    slug: 'orders',
    fields: [
      { name: 'status', type: 'select', options: ['pending', 'paid', 'shipped'] },
      { name: 'total', type: 'number' },
      { name: 'customer', type: 'relationship', relationTo: 'users', required: true },
      { name: 'store', type: 'relationship', relationTo: 'stores' },
      { name: 'internalNotes', type: 'textarea' },
    ],
  },
]

export const orderPaidTrigger = defineTrigger({
  slug: 'order-paid-customer',
  name: 'Order paid → customer',
  event: 'order.paid',
  data: {
    sources: [
      {
        type: 'collection',
        alias: 'order',
        collection: 'orders',
        lookup: { type: 'id', from: 'event.payload.orderId' },
        fields: ['status', 'total', 'customer', 'store'],
      },
      {
        type: 'collection',
        alias: 'customer',
        collection: 'users',
        lookup: { type: 'relationship', from: 'order.customer' },
        fields: ['name', 'email', 'phone'],
      },
      { type: 'resolver', alias: 'store', name: 'storeDetails', required: false },
    ],
  },
  recipients: [{ type: 'context', path: 'customer.id', alias: 'customer' }],
  deliveries: [
    { channel: 'email', template: 'order.paid', recipient: 'customer' },
    { channel: 'whatsapp', template: 'order.paid', recipient: 'customer' },
    { channel: 'inapp', template: 'order.paid', recipient: 'customer' },
  ],
  admin: { policy: 'managed', overridable: ['enabled', 'deliveries'] },
})

export const pluginOptions = (
  env: { metaAccessToken: string; metaPhoneNumberId: string } = {
    metaAccessToken: 'test-token',
    metaPhoneNumberId: '1234567890',
  },
): NotificationsPluginOptions => ({
  channels: ['email', 'whatsapp', 'inapp'],
  providers: {
    email: { defaultFromAddress: 'orders@example.com', defaultFromName: 'Example Store' },
    whatsapp: {
      provider: 'meta',
      accessToken: env.metaAccessToken,
      phoneNumberId: env.metaPhoneNumberId,
    },
  },
  events: {
    'order.paid': {
      label: 'Order paid',
      classification: 'transactional',
      schema: (payload) => {
        if (typeof payload.orderId !== 'string') throw new Error('orderId: Required')
        return payload
      },
      samplePayload: { orderId: 'ORD-1042' },
    },
  },
  data: {
    collections: {
      orders: { fields: ['status', 'total', 'customer', 'store'] },
      users: { fields: ['name', 'email', 'phone'] },
    },
    redact: ['customer.phone'],
  },
  dataResolvers: {
    storeDetails: {
      label: 'Store details',
      fields: ['name', 'supportEmail'],
      handler: async ({ payload, context }) => {
        const order = context.order as { store?: string } | null
        if (!order?.store) return null
        // In a generated-types app this is typed as `Store` already.
        const store = (await payload.findByID({
          collection: 'stores',
          id: order.store,
          depth: 0,
          disableErrors: true,
        })) as unknown as { name: string; supportEmail?: string } | null
        return store ? { name: store.name, supportEmail: store.supportEmail } : null
      },
    },
  },
  recipients: { defaultCountryCode: '+91' },
  templates: {
    registry: {
      'order.paid': {
        email: {
          subject: 'Order {{ order.id }} confirmed',
          body: 'Hi {{ customer.name }}, your order {{ order.id }} is confirmed. Total: {{ order.total }}. Thanks for shopping with {{ store.name | default "us" }}.',
          htmlBody:
            '<p>Hi {{ customer.name }},</p><p>Your order <strong>{{ order.id }}</strong> is confirmed.</p>',
        },
        whatsapp: 'Hi {{ customer.name }}, order {{ order.id }} is confirmed ({{ order.total }}).',
        inapp: { title: 'Order confirmed', body: 'Order {{ order.id }} is confirmed.' },
      },
    },
  },
  triggers: [orderPaidTrigger],
})
