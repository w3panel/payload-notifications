# Jobs and operations

## Tasks

| Slug | Queue (default) | Retries | Role |
|------|-----------------|---------|------|
| `notification:process-event` | `notifications` | 0 | Match triggers → data → recipients → create deliveries → queue sends |
| `notification:send` | `notifications` | 2 + exponential backoff (5s base, unexpected errors only) | Load delivery → policy → render → provider → attempt log → outcome / retry / fallback |
| `notification:reconcile` | `notifications` | 0 | Stale `sending` → `unknown`; resolve `unknown` via provider status |
| `notification:retention` | `notifications` | 0 | Prune old logs, deliveries and inbox events |

Override queue name with `jobs.queue`.

## Failure model

Trigger-based deliveries (see [reliability.md](./reliability.md)):

- **Retryable** (429, 502, 503, refused connections): the delivery goes back to `queued` and a new send job is queued with a back-off (`reliability`), up to its attempt limit  
- **Permanent** (4xx, missing user, policy): `failed` / `skipped`, plus the fallback channel if configured  
- **Unknown** (timeouts, dropped connections): `unknown`, never re-sent automatically; `notification:reconcile` and provider webhooks resolve it  
- **Re-runs**: processing an event again reuses existing deliveries (unique `idempotencyKey`); final or interrupted (`sending`) deliveries are never sent again  
- Unexpected errors (e.g. the database is down) before the provider call still throw, and Payload retries the job safely

Direct `queueNotificationSend` calls: retriable provider errors throw so Payload retries the same job; terminal outcomes return `skipped` / `failed` with a log row.

## Running the queue

### Long-lived Node

```ts
jobs: {
  autoRun: [{ cron: '* * * * *', queue: 'notifications', limit: 25 }],
}
```

### Serverless / Vercel

Skip `autoRun`. Schedule:

`GET /api/payload-jobs/run?queue=notifications`

Protect with Payload jobs access / `CRON_SECRET` as in your host.

## Observability surfaces

1. **`payload-jobs`** — queued / retrying / `hasError` / `totalTried`  
2. **`notification-deliveries`** — one row per recipient × channel: status, attempts, masked destination, trigger version, `lastError` / `skipReason`  
3. **`notification-logs`** — one row per attempt: channel outcome, `fingerprint`, `providerResponse`, `meta.deliveryId` / `meta.jobId` / `meta.testSend`  
4. **`notifications`** — in-app inbox rows  
5. **`observability.onDispatch`** — structured callback  

## Debugging checklist

1. Was `emitNotificationEvent` called (with `userId` when recipients use the event user)?  
2. Does a trigger or rule match the event? Check `notification-deliveries` for the `eventId` and any `skipReason`  
3. Is the jobs runner draining `notifications`?  
4. Policy / preferences blocking? Inspect log `error` / status `skipped`  
5. Template missing for channel? Check resolve errors in job failure output  
