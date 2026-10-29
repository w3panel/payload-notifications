# Reliability: duplicates, retries, fallback and webhooks

This page covers how trigger-based deliveries avoid duplicates, retry safely, fall back to other
channels and learn their final status. Direct `queueNotificationSend` calls keep the older
behaviour described in [jobs-and-operations.md](./jobs-and-operations.md).

## Duplicate protection

| Layer | Key | Stops |
| --- | --- | --- |
| Event inbox (`eventsInbox`) | `eventId` | Queueing the same event twice |
| Delivery record | `<idempotencyKey or eventId>::<trigger>::<recipient>::<channel>::<template>` (unique index) | Re-processing or replaying the same event |
| Dedupe key | Rendered `dedupe.key` + recipient + channel (+ window) | Two triggers describing the same action |

- **Versions aren't part of the key.** Delivery keys deliberately leave out the trigger and template
  versions, so publishing or rolling back a trigger never re-sends for an event that was already
  handled. The versions are recorded on each delivery instead.
- **Legacy fingerprints.** Direct sends without an `idempotencyKey` now use the `eventId`, so
  separate events no longer collide.

### Cross-trigger dedupe

Use this when an explicit event and a collection hook can both describe the same thing:

```ts
triggers: [
  defineTrigger({
    slug: 'order-paid',
    event: 'order.paid',
    dedupe: { key: 'order.paid:{{ event.payload.orderId }}' },
    deliveries: [{ channel: 'email', template: 'order.paid' }],
  }),
  defineTrigger({
    slug: 'order-paid-admin',
    source: { type: 'collection', collection: 'orders', operation: 'update' },
    conditions: { field: 'doc.status', operator: 'changedTo', value: 'paid' },
    dedupe: { key: 'order.paid:{{ doc.id }}', windowSeconds: 86400 },
    deliveries: [{ channel: 'email', template: 'order.paid' }],
  }),
]
```

- **What counts as a duplicate:** an earlier delivery with the same rendered key, recipient and
  channel. Only live deliveries count (queued, sending, sent, delivered or unknown), and only within
  `windowSeconds` if it's set.
- **What happens to it:** the duplicate is recorded as `skipped` with
  "Duplicate of delivery …" and isn't sent.
- **Warnings:** at startup and on publish, you're warned about triggers that share a source,
  channel and recipients without dedupe keys.

## Failures and retries

Every send is classified:

| Outcome | Examples | What happens |
| --- | --- | --- |
| `retryable` | 429, 502, 503, connection refused | Re-queued with a back-off, up to the attempt limit |
| `permanent` | 4xx (invalid number, rejected content) | `failed`; [fallback](#fallback) if configured |
| `unknown` | Timeout, dropped connection, 500, 504 | `unknown`, **never re-sent automatically**; see reconciliation |
| `policy` | Opt-out, suppression, `canSend` | `skipped`; fallback if configured |
| `duplicate`, `cancelled` | Dedupe, re-checked schedule | `skipped` / `cancelled` |

```ts
notificationsPlugin({
  reliability: {
    attempts: 3,                                   // default
    backoff: { type: 'exponential', delayMs: 5000, maxDelayMs: 3_600_000 },
    jitter: true,
    maxAttempts: 10,                               // cap for any trigger
    staleSendingMinutes: 30,
  },
  providers: { timeoutMs: 30_000 },
})

defineTrigger({
  …,
  reliability: { attempts: 5, channels: { sms: { attempts: 2 } } },
})
```

- **How retries are scheduled.** Payload only supports retries per task, not per job, so retries
  re-queue the delivery with `waitUntil`. The delivery shows `queued`, `attempts` and
  `nextAttemptAt`.
- **When a delivery counts as sending.** A delivery becomes `sending` only right before the provider
  call. If anything fails earlier, the delivery is still `queued` and is safe to retry.
- **Interrupted attempts.** If a send job finds its delivery already `sending`, the previous attempt
  was interrupted. The delivery becomes `unknown` rather than risking a second message.

### Attempt log

Each provider call writes one `notification-logs` row with these fields:

- `delivery`, linking to the delivery
- `attempt`
- `outcome`
- `durationMs`
- the provider and its message ID
- the provider response, with sensitive keys redacted

Rendered content is only stored when `logs.storeRendered: true`, because it can contain personal
data.

## Fallback

```ts
deliveries: [
  {
    channel: 'sms',
    template: 'auth.otp',
    fallback: { channel: 'email', template: 'auth.otp.email', on: ['permanent', 'no-destination', 'policy'] },
  },
]
```

- **What gets created:** a linked delivery (`fallbackOf`) to the same recipient on the other
  channel.
- **When:**
  - the recipient has no destination for the primary channel
  - policy blocks the primary channel
  - the primary fails permanently, or runs out of retries
  - a provider webhook later reports it failed
- **Never for `unknown`:** the first message may have arrived.

## Providers

Built-in providers cover Payload email, in-app, Twilio SMS and WhatsApp, and Meta WhatsApp. Replace
any channel with your own:

```ts
import { ProviderError, type NotificationProvider } from '@wtree/payload-notifications'

const msg91: NotificationProvider = {
  name: 'msg91',
  channels: ['sms'],
  capabilities: { html: false, hsm: false, media: false, maxLength: 160 },
  validateConfig: () => (process.env.MSG91_KEY ? [] : ['MSG91_KEY is not set']),
  send: async ({ to, content, signal }) => {
    const res = await fetch('https://api.msg91.com/…', { method: 'POST', signal, body: … })
    if (!res.ok) throw new ProviderError(`MSG91 ${res.status}`, { status: res.status })
    return { status: 'sent', providerMessageId: (await res.json()).id }
  },
  parseWebhook: async (request) => ({ verified: true, updates: [], inbound: [] }),
  getStatus: async (id) => undefined,
}

notificationsPlugin({ channels: ['sms'], providers: { custom: { sms: msg91 } } })
```

- **Classifying failures:** throw a `ProviderError` with the HTTP status, or an explicit
  `kind: 'retryable' | 'permanent' | 'unknown'`.
- **Cancellation:** the `signal` is aborted when `providers.timeoutMs` elapses.

## Webhooks

| Endpoint | Provider |
| --- | --- |
| `POST /api/payload-notifications/webhooks/twilio` | Twilio status callback **and** incoming-message URL |
| `GET` / `POST /api/payload-notifications/webhooks/meta` | Meta WhatsApp webhook (verification + notifications) |
| `GET` / `POST /api/payload-notifications/webhooks/provider/:channel` | A custom provider's `parseWebhook` |

```ts
notificationsPlugin({
  webhooks: {
    publicUrl: 'https://shop.example.com',        // the URL providers call, if behind a proxy
    twilio: { authToken: process.env.TWILIO_AUTH_TOKEN }, // defaults to the provider's token
    meta: { appSecret: process.env.META_APP_SECRET!, verifyToken: process.env.META_VERIFY_TOKEN! },
  },
})
```

- **Signatures:** requests are rejected with 403 unless the signature checks out. Twilio uses
  HMAC-SHA1 over the full URL and parameters; Meta uses `X-Hub-Signature-256`.
- **Status updates:**
  - **delivered / read** set `delivered`, plus `deliveredAt` / `readAt`
  - **sent** resolves an `unknown` send
  - **failed** marks the delivery failed and triggers its fallback
- **STOP / START replies** add or lift a `stop` suppression for that number.
- **Invalid or unsubscribed numbers** are suppressed. These are the Twilio error codes 21610,
  21211, 21614 and 63003.
- **Email bounces:** call `recordSuppression({ payload, options, channel: 'email', destination,
  reason: 'bounce' })` from your mail provider's webhook.

## Maintenance

| Task | Does |
| --- | --- |
| `notification:reconcile` | Marks `sending` deliveries older than `staleSendingMinutes` as `unknown`; resolves `unknown` ones via a provider's `getStatus` |
| `notification:retention` | Deletes logs, final deliveries and processed inbox events older than `maintenance.retention.*Days` |

```ts
maintenance: {
  reconcileCron: '*/15 * * * *',
  retentionCron: '0 3 * * *',
  retention: { logsDays: 90, deliveriesDays: 365, eventsDays: 30 },
}
```

Scheduled tasks run on the `notifications` queue, so your job runner must process that queue.
