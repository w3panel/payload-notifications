# Jobs and operations

## Tasks

| Slug | Queue (default) | Retries | Role |
|------|-----------------|---------|------|
| `notification:process-event` | `notifications` | 0 | Match triggers → data → recipients → create deliveries → queue sends |
| `notification:send` | `notifications` | 2 + exponential backoff (5s base) | Load delivery → policy → resolve → render → channel → record outcome |

Override queue name with `jobs.queue`.

## Failure model

- **Retriable** provider errors (timeout, rate limit, unavailable, temporary): handler **throws** → Payload retries the same job; the delivery stays `sending`  
- **Terminal** (missing user, policy deny, skip): soft success with `status: 'skipped' | 'failed'`, a log row, and the same status on the delivery  
- **Exhausted retries**: `onFail` marks the delivery `failed` and writes a log row  
- **Re-runs**: processing an event again reuses existing deliveries (unique `idempotencyKey`); a final delivery is never sent twice  
- Do **not** force `state: 'succeeded'` in a host override when a send should retry  

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
