# Data sources

Data sources load the data a notification needs, such as the order, its customer or the store,
before the template renders. Templates then read simple paths like `{{ customer.name }}`, without
knowing how the data was queried.

## 1. Allowlist collections and fields

Data sources may only read collections and fields that the developer allowlists:

```ts
notificationsPlugin({
  data: {
    collections: {
      orders: { label: 'Orders', fields: ['status', 'total', 'customer', 'store', 'items'] },
      users: { fields: ['name', 'email', 'phone'] },
    },
    // Masked in previews, the context inspector and logs
    redact: ['customer.phone'],
    // Added to the built-in sensitive-field denylist
    sensitiveFields: ['taxId'],
  },
})
```

- **Checked at config time:** every allowlisted collection and field must exist in the Payload config. `id` is always allowed. Group fields use dot paths, such as `meta.source`.
- **Sensitive fields:** these can never be allowlisted or loaded:
  - `password`, `hash`, `salt`, `resetPasswordToken`, `apiKey`, `sessions`
  - any field whose name contains `token` or `secret`
  - anything listed in `data.sensitiveFields`

  Every lookup, resolver and computed result is also stripped of sensitive keys at runtime. Event
  payloads are developer-provided, so they pass through unchanged.

## 2. Register resolvers and computed values

```ts
notificationsPlugin({
  dataResolvers: {
    storeDetails: {
      label: 'Store details',
      fields: ['name', 'supportEmail'],
      timeoutMs: 3000, // default 5000, max 60000
      output: storeSchema, // optional Standard Schema / validator
      handler: async ({ payload, context, signal }) => {
        const order = context.order as { store: string }
        const store = await payload.findByID({ collection: 'stores', id: order.store, depth: 0 })
        return { name: store.name, supportEmail: store.supportEmail }
      },
    },
  },
  computed: {
    formattedTotal: (context) => ({ total: formatINR((context.order as { total: number }).total) }),
  },
})
```

- **Failures:** a resolver that times out, throws or returns invalid output raises a
  `ResolverError` with `{ resolver, kind }`, where `kind` is `timeout`, `invalid-input`,
  `invalid-output` or `error`. The error is also logged with `payload.logger.warn`.
- **Admin access:** admins can select registered resolvers in the UI but can never run their own
  code.

## 3. Attach sources to a rule

```ts
rules: [
  {
    event: 'order.paid',
    channels: ['email', 'inapp'],
    template: 'order.paid',
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
          fields: ['name', 'email'],
        },
        { type: 'resolver', alias: 'store', name: 'storeDetails', required: false },
      ],
    },
  },
]
```

| Type | Reads |
| --- | --- |
| `event` | The event, or `fields` picked from it, e.g. `payload.orderId` |
| `document` | The document that triggered a collection event |
| `collection` | `lookup.type: 'id'` finds by the ID at `from`; `'relationship'` follows an ID, populated doc, polymorphic value or `hasMany` list (`maxItems`, default 50) |
| `resolver` | A registered `dataResolvers` entry, with an optional static `input` |
| `computed` | A registered `computed` function over the context resolved so far |

- **Resolution order:** sources resolve in dependency order, whatever order you list them in.
  Cycles and unknown aliases are configuration errors.
- **Lookup paths:** `from` paths start at:
  - `event`: the full event, e.g. `event.payload.orderId` or `event.userId`
  - `doc` / `previous`: the documents on a collection event
  - an earlier source's alias
- **Relationship lookups:** the field they read must be in the parent source's `fields`.
- **Required sources:** sources default to `required: true`. A required source that resolves to
  nothing skips the send with `data-missing` or `resolver-failed`, and the skip is written to the
  logs. An optional source becomes `null`. Values are never invented. Database errors are rethrown,
  so the job retries.
- **Reserved aliases:** `event`, `payload`, `userId`, `trigger`, `recipient`, `doc`, `previous`.

## 4. Template context

```text
{
  event: 'order.paid',      // event name (unchanged)
  userId: 'user_1',         // unchanged
  payload: { orderId },     // event payload (unchanged)
  trigger: { name, eventId, occurredAt, classification },
  order: { id, status, total, customer, store },
  customer: { id, name, email },
  store: { name, supportEmail },
}
```

```handlebars
Hi {{ customer.name }}, your order {{ order.id }} is confirmed.
Total: {{ order.total | currency "INR" }}. Thanks for shopping with {{ store.name }}.
```

## 5. Preview with real data

`POST /api/notification-templates/preview` accepts `sampleEvent` and `sources`:

```json
{
  "channel": "email",
  "doc": { "email": { "subject": "Order {{ order.id }}", "textBody": "Hi {{ customer.name }}" } },
  "sampleEvent": { "name": "order.paid", "payload": { "orderId": "ORD-1042" } },
  "sources": [ … ]
}
```

- **Sample payload:** when `sampleEvent.payload` is omitted, the registered event's
  `samplePayload` is used. The payload is validated against the event schema.
- **Access:** lookups run with the caller's access (`overrideAccess: false`).
- **Response:** includes `data.context`, the redacted context inspector, and `data.missing`, the
  optional sources that resolved to nothing.
- **Pickers:** `GET /api/notifications/data-sources` lists the allowlisted collections and fields
  plus the registered resolvers and computed functions.
