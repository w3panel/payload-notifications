# Events

Application events are the business facts your code reports, such as `order.paid`. Registering
them is optional, but a registered event gets payload validation at emit time, a default
classification, and an entry in the admin pickers.

## Register events

```ts
import { z } from 'zod'

notificationsPlugin({
  events: {
    'order.paid': {
      label: 'Order Paid',
      description: 'Payment confirmed by the payment provider webhook',
      classification: 'transactional',
      schema: z.object({ orderId: z.string(), total: z.number() }),
      samplePayload: { orderId: 'ORD-1042', total: 2499 },
    },
  },
  // Reject emits for unregistered events (default false)
  eventsStrict: false,
})
```

- **`schema`**: any [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, …) or a
  function `(payload) => payload` that throws to reject. A transformed payload, such as one with
  coerced numbers, is what gets queued.
- **`classification`**: used when an emit omits `classification`.
- **`samplePayload`**: drives previews, tests and the field list shown in admin.
- **Event names**: letters and numbers with single `.`, `_`, `:` or `-` separators. Template slugs
  follow the same rule.

## Emit events

```ts
const event = await emitNotificationEvent({
  payload,
  event: {
    name: 'order.paid',
    userId: customerId,
    idempotencyKey: `order.paid:${order.id}`,
    payload: { orderId: order.id, total: order.total },
  },
})
event.eventId // e.g. "evt_3f0c…" (generated when not supplied)
```

`emitNotificationEvent` validates the event against the installed plugin's registry. It then fills
in `eventId` and `occurredAt`, queues the event on the plugin's `jobs.queue`, and returns the
prepared event. An invalid payload throws before anything is queued, with an error like
`payload-notifications: invalid payload for event "order.paid": orderId: Required`.

Emit only after the business action is confirmed, and only from trusted server code. For example,
emit `order.paid` from the verified payment webhook, never from a client request.

## Listing events

- `listRegisteredEvents(options)` returns `{ name, label, description, classification, samplePayload, fields, hasSchema }[]`.
- `GET /api/payload-notifications/events` returns the same list to authenticated users. It is used by
  admin pickers.
