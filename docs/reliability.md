# Reliability: duplicates, retries, fallback and webhooks

This page covers how trigger-based deliveries avoid duplicates, retry safely, fall back to other
channels and learn their final status. Direct `queueNotificationSend` calls keep the older
behaviour described in [jobs-and-operations.md](./jobs-and-operations.md).

## Duplicate protection

| Layer                       | Key                                                                                         | Stops                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Event inbox (`eventsInbox`) | `eventId`                                                                                   | Queueing the same event twice             |
| Delivery record             | `<idempotencyKey or eventId>::<trigger>::<recipient>::<channel>::<template>` (unique index) | Re-processing or replaying the same event |
| Send-once delivery record   | `<idempotencyKey or eventId>::<channel>::<identity>` (`deliveries.key: 'recipient'`)        | A second message per event and channel    |
| Dedupe key                  | Rendered `dedupe.key` + recipient + channel (+ window)                                      | Two triggers describing the same action   |

- **Versions aren't part of the key.** Delivery keys deliberately leave out the trigger and template
  versions, so publishing or rolling back a trigger never re-sends for an event that was already
  handled. The versions are recorded on each delivery instead.
- **Legacy fingerprints.** Direct sends without an `idempotencyKey` now use the `eventId`, so
  separate events no longer collide.

### Send once per event, recipient and channel

With `deliveries.key: 'recipient'` the delivery key leaves out trigger and template. The
`<identity>` part is:

- email: `email#<sha256 of the normalised address>` (trimmed, lower-cased)
- WhatsApp / SMS: `phone#<sha256 of the normalised number>`
- in-app / push, or no destination: `user#<id>`, else `key#<sha256 of the recipient key>`

So an inbox reached as an account (`user:12`) and as a static address (`email:owner@shop.test`)
gets one email. A second plan for the key finds the existing delivery (result status
`existing`, lifecycle stage `duplicate`). If two plans race, the unique index refuses the second
insert, `isDuplicateKeyError` recognises it and the plan reports the existing delivery. Fallback
deliveries of a send-once delivery use a send-once key for their own channel, so a fallback never
doubles a delivery the recipient already has there.

**When the key holder doesn't send.** A delivery from another route (another trigger or template)
never loses its message because the key holder ended without sending:

- **Standby.** If the holder hasn't finished yet, the other route's delivery is stored as a
  standby: `skipped`, `skipReason` "Standby: …", key `<key>::standby:<trigger>:<template>`, no send
  job. If the holder then ends `skipped` (consent, policy), `cancelled` (veto, admin cancel) or
  `failed`, the oldest standby takes over the key, is queued and emits `planned`. If the holder
  sends (or ends `unknown`), standbys stay skipped.
- **Hand-over at planning.** If the holder already ended that way, a plan from another route takes
  the key over directly.
- Either way the old holder's key is renamed `<key>::superseded:<id>`, and a `failed` holder is
  moved to `cancelled` first, so an admin retry can't also send it.
- Replays of the same route still find its own delivery (`existing`), whatever its status: retry a
  failed delivery from the admin instead of planning again.

**Which route wins a shared inbox.** Triggers plan in `priority` order (higher first, default 0,
ties keep match order), so give the route whose template a shared inbox should get a higher
`priority`. The others wait as standbys.

### Veto before send

`deliveries.beforeSend({ payload, delivery, attempt })` runs before every send attempt (after the
already-final and interrupted-send checks, before consent, policy and rendering). Returning
`{ allow: false, reason }` ends the delivery `cancelled` with `skipReason: reason`, writes the
attempt log ("Cancelled: …") and emits a `cancelled` lifecycle event. No fallback is created.

If the hook throws, nothing has been sent. The attempt is counted (`attempts`, `lastError`, and the
next call gets `attempt + 1`) and `maxAttempts` grows by one, so hook failures don't use up the
provider's retries. The delivery stays `queued` and the send job retries it. If recording the attempt
fails, that error is logged and the hook's error is still the one the job reports. When the job's
retries run out, the delivery ends `failed` with a `failed` lifecycle event and no fallback. With
`deliveries.key: 'recipient'` a standby waiting behind it is sent instead; otherwise the delivery
keeps its key and only an admin retry can send it.

### One send job per delivery

Before acting, a send job claims the delivery with a compare-and-set on its status: one conditional
`UPDATE … SET status, …, updated_at WHERE id = ? AND status = ? RETURNING id` on Postgres, SQLite and
D1, `findOneAndUpdate` on MongoDB. The claim writes the attempt count, reason and timestamp in the
same statement. Ending a delivery before the provider call (cancelled, skipped, failed, unknown) and
moving it to `sending` both require the status the job read. If two send jobs run for one delivery (a
reconcile re-queue next to the original job, say), the second finds the status changed and stops
quietly, so a delivery can't end both `cancelled` and `sent`.

- A job that finds a delivery `sending` within the provider timeout plus 30 seconds of its claim
  leaves it to the job that claimed it. Older `sending` deliveries count as interrupted and end
  `unknown`; reconciliation also marks them `unknown` after `reliability.staleSendingMinutes`, with
  an `unknown` lifecycle event.
- If a driver's result doesn't say how many rows changed, the claim reads the row back instead of
  retrying. Adapters with no atomic path use a filtered update and log a warning once.

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

| Outcome                  | Examples                               | What happens                                                   |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| `retryable`              | 429, 502, 503, connection refused      | Re-queued with a back-off, up to the attempt limit             |
| `permanent`              | 4xx (invalid number, rejected content) | `failed`; [fallback](#fallback) if configured                  |
| `unknown`                | Timeout, dropped connection, 500, 504  | `unknown`, **never re-sent automatically**; see reconciliation |
| `policy`                 | Opt-out, suppression, `canSend`        | `skipped`; fallback if configured                              |
| `duplicate`, `cancelled` | Dedupe, re-checked schedule            | `skipped` / `cancelled`                                        |

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
    fallback: {
      channel: 'email',
      template: 'auth.otp.email',
      on: ['permanent', 'no-destination', 'policy'],
    },
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

| Endpoint                                                             | Provider                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/payload-notifications/webhooks/twilio`                    | Twilio status callback **and** incoming-message URL  |
| `GET` / `POST /api/payload-notifications/webhooks/meta`              | Meta WhatsApp webhook (verification + notifications) |
| `GET` / `POST /api/payload-notifications/webhooks/provider/:channel` | A custom provider's `parseWebhook`                   |

```ts
notificationsPlugin({
  webhooks: {
    publicUrl: 'https://shop.example.com', // the URL providers call, if behind a proxy
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

| Task                     | Does                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `notification:reconcile` | Marks `sending` deliveries older than `staleSendingMinutes` as `unknown`; resolves `unknown` ones via a provider's `getStatus` |
| `notification:retention` | Deletes logs, final deliveries and processed inbox events older than `maintenance.retention.*Days`                             |

```ts
maintenance: {
  reconcileCron: '*/15 * * * *',
  retentionCron: '0 3 * * *',
  retention: { logsDays: 90, deliveriesDays: 365, eventsDays: 30 },
}
```

Scheduled tasks run on the `notifications` queue, so your job runner must process that queue.
