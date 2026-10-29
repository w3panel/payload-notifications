# Rules and triggers

> Rules are the legacy shorthand: each rule compiles into a trigger that sends to the event user
> on every listed channel. For multiple recipients, per-recipient deliveries and admin overrides,
> use v2 triggers — see [triggers.md](./triggers.md).

## Rules

Rules live in plugin options. Each matching enabled rule fans out to per-channel send jobs.

```ts
notificationsPlugin({
  rules: [
    {
      event: 'order.paid',
      channels: ['email', 'inapp'],
      template: 'order.paid', // slug / registry key
      enabled: true,
      // classification comes from the emitted event, not the rule
      condition: async (payload) => payload.total > 0,
      templateOverrides: {
        email: { subject: 'Paid: {{ payload.orderId }}' },
      },
    },
  ],
})
```

Notes:

- `enabled: false` skips the rule  
- `condition` receives the event `payload` object  
- Only channels also listed in plugin `channels` are queued  
- Event `classification` (`transactional` | `marketing`) is forwarded into each send for consent checks  

## `defineTrigger`

Typed helper that validates a rule shape:

```ts
import { defineTrigger } from '@wtree/payload-notifications'

const orderPaid = defineTrigger({
  event: 'order.paid',
  channels: ['email', 'inapp'],
  template: 'order.paid',
})

notificationsPlugin({ rules: [orderPaid] })
```

## Mapping domain actions → notifications

Typical host pattern (examples only — this package does not wire your ecommerce hooks):

```ts
// After order payment succeeds:
await emitNotificationEvent({
  payload,
  event: {
    name: 'order.paid',
    userId: String(order.customer),
    classification: 'transactional',
    idempotencyKey: `order.paid:${order.id}`,
    payload: {
      orderId: order.id,
      total: order.total,
    },
  },
})
```

Checklist for each domain action:

1. Choose a stable **event name** (`order.shipped`, `auth.magic-link`, …)  
2. Add / seed a **template** (registry and/or DB slug)  
3. Add a **rule** with channels + template key  
4. Call **`emitNotificationEvent`** (or `queueNotificationSend` for a single channel) from the action  
5. Confirm the **jobs queue** runs and inspect `notification-logs`  

## Direct single-channel send

```ts
import { queueNotificationSend, NOTIFICATIONS_JOB_QUEUE } from '@wtree/payload-notifications'

await queueNotificationSend({
  payload,
  queue: NOTIFICATIONS_JOB_QUEUE,
  input: {
    userId: 'user_1',
    channel: 'inapp',
    template: 'order.paid',
    event: 'order.paid',
    eventPayload: { orderId: '1' },
  },
})
```
