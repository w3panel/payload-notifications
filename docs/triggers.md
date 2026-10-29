# Triggers, recipients and deliveries

A **trigger** is a complete notification workflow. It defines:

- which event starts it
- what data it loads
- who receives it
- which channels and templates each recipient gets

Code-defined triggers and admin-created triggers ([admin-triggers.md](./admin-triggers.md)) share the same engine. Legacy `rules`
are compiled into triggers automatically, so existing configs keep working.

## Defining a trigger

```ts
import { defineTrigger, notificationsPlugin } from '@wtree/payload-notifications'

const orderPaid = defineTrigger({
  slug: 'order-paid-customer',          // stable ID: deliveries and overrides reference it
  event: 'order.paid',                  // or source: { type: 'event', event: 'order.*' }
  data: { sources: [/* see data-sources.md */] },
  recipients: [
    { type: 'context', path: 'customer.id', alias: 'customer' },
    { type: 'static', email: 'ops@example.com', alias: 'ops' },
  ],
  deliveries: [
    { channel: 'email', template: 'order.paid', recipient: 'customer' },
    { channel: 'whatsapp', template: 'order.paid', recipient: 'customer' },
    { channel: 'inapp', template: 'order.paid', recipient: 'customer' },
    { channel: 'email', template: 'ops.order-paid', recipient: 'ops' },
  ],
  classification: 'transactional',     // optional; defaults to the event's classification
  admin: { policy: 'managed', overridable: ['enabled', 'deliveries'] },
})

notificationsPlugin({ triggers: [orderPaid] })
```

- **Sources:** `source` can be `{ type: 'event', event }`, which also accepts `order.*` or `*`, or
  `{ type: 'collection', collection, operation }` for collections listed in `collectionEvents`.
- **Conditions and scheduling:** `conditions`, `deliveries[].when` and `schedule` are covered in
  [automation.md](./automation.md).
- **Legacy shape:** `defineTrigger` still accepts `{ event, channels, template }` and returns it
  unchanged for `rules`.
- **Checked at startup:**
  - slugs, sources and deliveries are well-formed
  - recipients are valid
  - each delivery targets a defined recipient alias on an enabled channel
  - no in-app delivery goes to a static recipient
  - there are no duplicate deliveries
- **Warning on init:** a code-registry template that lacks a channel only logs a warning, because
  an active DB template may provide it.

## Recipients

| Type | Resolves to |
| --- | --- |
| `eventUser` (default) | `event.userId` |
| `context` / `relationship` | A user ID, user document, polymorphic value or list of them at `path` (e.g. `customer.id`, `order.accountManager`) |
| `static` | A fixed `email` and/or `phone` (e.g. an ops mailbox) |
| `role` | Users whose `recipients.roleField` (default `roles`) contains `role` |
| `resolver` | A registered `recipientResolvers` entry returning user IDs, user docs or `{ email, phone, name }` |
| `query` | A registered `recipientQueries` entry (`where` object or function of the context) |

```ts
notificationsPlugin({
  recipients: {
    defaultCountryCode: '+91',          // for phone numbers stored without a country code
    destinationFields: { sms: ['mobile', 'phone'] },
    roleField: 'roles',
    maxPerEvent: 100,
  },
  recipientResolvers: {
    accountManager: async ({ payload, context }) => [String((context.order as any).accountManager)],
  },
  recipientQueries: {
    storeAdmins: { where: (context) => ({ store: { equals: (context.order as any).store } }), maxResults: 20 },
  },
})
```

- **User loading:** users are loaded in one query that selects only the destination fields.
- **Normalization:** phones are normalized to E.164 and emails to lowercase.
- **Merging:** a person found through several recipient definitions, or by the same destination,
  is merged into one recipient that keeps all their aliases.
- **Not found:** missing users and invalid destinations produce warnings, not errors.
- **In templates:** `{{ recipient.name }}`, `{{ recipient.email }}`, `{{ recipient.locale }}`.

## Deliveries

Each trigger turns into one **delivery** per recipient per delivery definition. Each delivery is
stored in `notification-deliveries` (`collections.deliveries`), and its fields are:

- `event`, `eventId`
- `trigger`, `triggerOrigin`, `triggerVersion`, `triggerPolicy`
- `channel`, `templateSlug`, `templateVersion`
- `recipientKey`, `recipientId`, `destinationMasked`
- `status`: `queued` → `sending` → `sent` | `skipped` | `failed`
- `attempts`, `providerMessageId`, `sentAt`, `lastError`, `skipReason`
- `idempotencyKey`, which is unique

The raw destination, the captured template context and the overrides are server-only fields. They
are hidden from the API and the admin.

### Pipeline

1. **Process event.** `notification:process-event` handles the event:
   1. It matches the event against the code triggers and published admin triggers.
   2. For each matched trigger, it checks the legacy `condition`, then loads the data context and
      resolves recipients once.
   3. It creates one delivery record for each recipient and delivery definition, keyed by an
      idempotency key: `<idempotencyKey or eventId>::<trigger>::<recipient>::<channel>::<template>`.
      If a record with that key already exists, it is reused rather than created again.
   4. A recipient with no destination for a channel gets a `skipped` record and no job.
   5. Every new `queued` record gets a `notification:send` job with `{ deliveryId }`.
2. **Send.** `notification:send` handles one delivery:
   1. It loads the delivery. If the delivery is already final, it does not send again.
   2. It re-checks the user and their consent at send time.
   3. It renders the template against the context captured when the event was processed and sends
      it to the stored destination.
   4. It writes the outcome to the delivery, plus one attempt row in `notification-logs` with
      `meta.deliveryId`.
3. **Retry.** A retriable provider failure leaves the delivery in `sending` and throws, so Payload
   retries the same job. When retries run out, `onFail` marks the delivery `failed`.

Processing the same event again, or emitting the same `idempotencyKey` twice, creates no new
deliveries.

`queueNotificationSend` (a direct single-channel send without a trigger) keeps the legacy path: no
delivery record, with deduplication through `notification-logs` fingerprints.

## Code and admin triggers: precedence

Code defines what is possible, and admins configure workflows within those limits. Each code
trigger declares `admin.policy`:

| Policy | Admin-created triggers |
| --- | --- |
| `independent` (default) | Admin triggers on the same event run **in addition**; an admin record may not reuse the code slug |
| `managed` | One admin record with `overrides: '<code slug>'` replaces only the `overridable` fields (`enabled`, `recipients`, `deliveries`, `data`) |
| `enforced` | Read-only in admin; cannot be disabled or overridden |

Records that break these rules are rejected and logged; they are never merged silently. Deliveries
record which trigger version and policy produced them (`triggerOrigin`, `triggerVersion`,
`triggerPolicy`).

See [`examples/order-paid`](../examples/order-paid) for a complete workflow.
