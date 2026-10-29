# Example: order paid → customer

The reference workflow for the trigger engine:

1. Payment-confirmation code emits `order.paid` with `{ orderId }`.
2. The `order-paid-customer` trigger matches the event.
3. Data sources load the order, its customer through the relationship, and store details through
   a resolver.
4. The recipient is the customer at `customer.id`.
5. The trigger creates three deliveries for that customer: email, WhatsApp and in-app.
6. Each send job sends one delivery, checks consent at send time, and records the outcome on the
   delivery and in `notification-logs`.

```ts
import { buildConfig } from 'payload'
import { notificationsPlugin } from '@wtree/payload-notifications'
import { collections, pluginOptions } from './examples/order-paid'

export default buildConfig({
  collections,
  plugins: [
    notificationsPlugin(
      pluginOptions({
        metaAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN!,
        metaPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID!,
      }),
    ),
  ],
})

// In the payment webhook, after the payment is verified:
await emitNotificationEvent({
  payload,
  event: {
    name: 'order.paid',
    userId: order.customer,
    idempotencyKey: `order.paid:${order.id}`,
    payload: { orderId: order.id },
  },
})
```

The trigger is `managed`, so an admin-created override can change its `enabled` and
`deliveries` fields; nothing else can be overridden.

The test in `tests/orderPaidWorkflow.test.ts` runs this whole workflow.
