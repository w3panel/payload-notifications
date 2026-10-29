# Getting started

## Install

```bash
bun add @wtree/payload-notifications
# or: npm i / pnpm add / yarn add
```

Peer: Payload `^3.92.0` or `>=4.0.0-beta.4 <5` (see [COMPATIBILITY.md](../COMPATIBILITY.md)). For the admin template studio, the host should also provide `react` and `@payloadcms/ui` (already present in typical Payload apps).

## Minimal config

```ts
import { buildConfig } from 'payload'
import { notificationsPlugin } from '@wtree/payload-notifications'

export default buildConfig({
  // ...
  plugins: [
    notificationsPlugin({
      channels: ['email', 'inapp'],
      providers: {
        email: { defaultFromAddress: 'noreply@example.com' },
      },
      rules: [
        {
          event: 'order.paid',
          channels: ['email', 'inapp'],
          template: 'order.paid',
        },
      ],
    }),
  ],
})
```

After installing or upgrading, regenerate the Payload **import map** so `@wtree/payload-notifications/admin#TemplateStudioField` resolves.

## Emit your first event

```ts
import { emitNotificationEvent, NOTIFICATIONS_JOB_QUEUE } from '@wtree/payload-notifications'

await emitNotificationEvent({
  payload,
  queue: NOTIFICATIONS_JOB_QUEUE, // default 'notifications'
  event: {
    name: 'order.paid',
    userId: String(user.id),
    classification: 'transactional',
    idempotencyKey: `order.paid:${order.id}`,
    payload: { orderId: order.id },
  },
})
```

Jobs:

1. `notification:process-event` matches triggers (and `rules`), resolves data and recipients, and creates `notification-deliveries` records
2. Queues one `notification:send` job per delivery on the `notifications` queue
3. Channel adapters deliver; outcomes land on the delivery and in `notification-logs` / `notifications`

## Ensure the queue runs

- Long-lived hosts: `jobs.autoRun` for `queue: 'notifications'`
- Serverless (Vercel): cron `GET /api/payload-jobs/run?queue=notifications` with `CRON_SECRET`

See [jobs-and-operations.md](./jobs-and-operations.md).

## Next steps

- [templates.md](./templates.md) — registry vs DB templates  
- [admin-templates.md](./admin-templates.md) — preview / test-send  
- [rules-and-triggers.md](./rules-and-triggers.md) — wire domain actions  
- [end-to-end.md](./end-to-end.md) — full checklist  
- [options-reference.md](./options-reference.md) — all plugin options  
