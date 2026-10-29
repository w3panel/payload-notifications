# Conditions, collection events and scheduling

This page builds on [triggers.md](./triggers.md) and covers how to:

- filter triggers and deliveries with JSON conditions
- start triggers from collection changes
- delay or time deliveries
- keep automated workflows safe

## Conditions

Conditions are JSON trees, so admins can build them later without running any code.

```ts
defineTrigger({
  slug: 'big-paid-orders',
  event: 'order.paid',
  data: { sources: [/* order … */] },
  conditions: {
    all: [
      { field: 'order.status', operator: 'equals', value: 'paid' },
      { field: 'order.total', operator: 'greaterThan', value: 5000 },
      { not: { field: 'event.payload.channel', operator: 'in', value: ['pos'] } },
      { custom: 'isVipCustomer' },
    ],
  },
  deliveries: [
    { channel: 'email', template: 'order.vip' },
    // Per-recipient condition: recipient.* is in scope
    { channel: 'inapp', template: 'order.vip', when: { field: 'recipient.id', operator: 'exists' } },
  ],
})
```

| Operator | Meaning |
| --- | --- |
| `equals`, `notEquals` | Loose equality: `'6000'` equals `6000`, and a populated relationship equals its ID |
| `in`, `notIn` | Value is (not) one of an array |
| `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual` | Numbers, numeric strings or ISO dates |
| `exists` | Not null, undefined or empty (`value: false` inverts it) |
| `contains` | Substring or array item |
| `changed`, `changedTo`, `changedFrom` | Compares `doc.*` (or a `document` source alias) with `previous.*`. Collection triggers only |

- **Field paths** start with one of these roots:
  - `event`: the full event, e.g. `event.payload.total`, `event.userId`
  - `payload`
  - `doc` / `previous`: collection triggers only
  - `trigger`
  - a data source alias
  - `recipient`: delivery `when` only
- **Custom conditions** are registered by the developer and referenced as `{ custom: name }`:

  ```ts
  notificationsPlugin({
    conditions: {
      isVipCustomer: {
        label: 'VIP customer',
        handler: ({ scope }) => (scope.customer as { tier?: string })?.tier === 'vip',
      },
    },
  })
  ```

- **When conditions run:** conditions that only read `event`, `payload`, `doc`, `previous` or
  `trigger` run **before** data sources load, so no queries are made for events that don't match.
  Conditions that read an alias or call a custom condition run after the data loads.
- **Checked at startup:**
  - operators and their values
  - known roots
  - fields the alias actually loads
  - captured `doc` fields
  - change operators only on collection triggers
- **Warnings, not errors:** payload paths that are missing from the event's `samplePayload`.

The legacy `condition: (payload) => boolean` function still works on code triggers.

## Collection events

Developers choose which collections can start triggers:

```ts
notificationsPlugin({
  collectionEvents: {
    orders: {
      operations: ['create', 'update'], // default; add 'delete' to capture deleted documents
      capture: ['status', 'total'],     // fields copied into doc / previous
      userField: 'customer',            // becomes event.userId
      // onlyWhenCaptureChanges: true   // default: updates that change no captured field emit nothing
    },
  },
  triggers: [
    defineTrigger({
      slug: 'order-paid-from-admin',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      conditions: { field: 'doc.status', operator: 'changedTo', value: 'paid' },
      data: { sources: [{ type: 'document', alias: 'order', fields: ['status', 'total'] }] },
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    }),
  ],
})
```

- **Hooks:** `afterChange` and `afterDelete` hooks are added once, when the config is built, and
  only to the listed collections. They run after the collection's own hooks.
- **The event:** each change emits `collection.<slug>.<operation>`, which carries:
  - `doc` and `previous`, holding only the captured fields
  - `payload: { id, collection, operation }`
- **Only real changes:** editing an order's notes does not emit an event, because `notes` is not
  captured. A `changedTo: 'paid'` condition only matches the update that actually changes the
  status.
- **Delete events** capture fields from the deleted document; `previous` is `null`.
- **Rejected at startup:**
  - the plugin's own collections
  - sensitive fields
  - fields that don't exist on the collection
  - triggers on collections or operations that aren't configured

> Prefer explicit application events for business-critical actions such as payments: emit
> `order.paid` from the verified payment webhook. Collection events suit admin-driven changes, such
> as a status edited in the admin panel. If you use both for the same action, see the duplicate
> protection planned in Phase 5.

## Guards

- **Skip notifications for a write** with
  `payload.update({ …, context: { skipNotifications: true } })` or
  `req.context.skipNotifications = true`.
- **Depth limit** (`maxEventDepth`, default 3):
  - Every event records how many notification-processing levels produced it.
  - Resolvers receive the job's `req`; pass it to your writes:
    `payload.update({ collection: 'orders', id, data, req })`.
  - Collection changes made with that `req` count as one level deeper.
  - At the limit, collection hooks skip with a warning and `emitNotificationEvent` throws. A
    workflow that writes to a collection it listens to stops instead of looping.
- **Tenancy** (`tenancy: { field: 'tenant', userField?: 'tenant' }`):
  - Collection events copy the tenant from the changed document.
  - Collection lookups treat documents belonging to another tenant as missing. Documents without
    the field are not scoped.
  - `role` and `query` recipients only match users in the event's tenant.
  - The tenant is available as `{{ trigger.tenant }}`.

## Transactions and the event inbox

- **Transactions:** collection hooks queue their event job with the hook's `req`, and
  `emitNotificationEvent({ …, req })` does the same for application events.
  - On databases where Payload runs transactions (Postgres, SQLite, MongoDB replica sets), the job
    is created atomically with the change. If the write rolls back, no notification is queued.
  - On adapters without transactions, the job is written immediately. Check your adapter, for
    example Cloudflare D1.
- **Event inbox** (`eventsInbox: true`) adds a `notification-events` collection (set its slug with
  `collections.events`):
  - It keeps one record per `eventId`, written with the same `req`.
  - Each record tracks `received` → `processing` → `processed` | `failed`, plus attempts, matched
    triggers, the number of new deliveries and any error.
  - The raw event is server-only, since payloads may hold magic links or OTPs.
  - An `eventId` that is emitted twice is only queued once.
- **Replay:** `replayNotificationEvent({ payload, options, eventId })` re-queues a stored event.
  Existing deliveries are reused, so only deliveries that are new are created, for example from a
  trigger enabled since.

## Scheduling

```ts
defineTrigger({
  slug: 'booking-reminder',
  event: 'booking.confirmed',
  data: { sources: [/* booking via event.payload.bookingId */] },
  conditions: { field: 'booking.status', operator: 'equals', value: 'confirmed' },
  schedule: {
    type: 'relative',
    at: 'booking.startsAt',
    offset: '-24h',
    recheckConditions: true, // cancel if the booking is cancelled before the reminder
    skipIfPast: true,        // booked less than 24h ahead: no reminder
  },
  deliveries: [{ channel: 'email', template: 'booking.reminder' }],
})
```

| `schedule.type` | Send time |
| --- | --- |
| `immediate` (default) | Now |
| `delay` | `delay` after the event (`30m`, `24h`, `2d`, milliseconds) |
| `at` | The timestamp at `at` (e.g. `event.payload.sendAt`) |
| `relative` | `at` plus `offset` (negative for "before") |

- **Queueing:** deliveries store `scheduledFor` and are queued with Payload's `waitUntil`. A job
  runner must be draining the queue.
- **`recheckConditions`:** when the delivery is due:
  - the trigger must still exist and be enabled
  - collection documents are re-read and data sources reload
  - `conditions` and the delivery's `when` must still match

  Otherwise the delivery becomes `cancelled`, logged with the reason. When it still applies, it
  renders from the fresh data.
- **Quiet hours** move sends out of a local time window:

  ```ts
  notificationsPlugin({
    quietHours: { start: '21:00', end: '08:00', timezone: 'Asia/Kolkata' },
    // classifications: ['marketing'] (default)
  })
  ```

  The recipient's timezone is used when it's known (`recipients.destinationFields.timezone`);
  otherwise the configured `timezone` is. Transactional deliveries are not delayed unless they are
  listed in `classifications`.
