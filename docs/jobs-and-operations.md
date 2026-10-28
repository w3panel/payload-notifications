# Jobs and operations

## Tasks

| Slug | Queue (default) | Retries | Role |
|------|-----------------|---------|------|
| `notification:process-event` | `notifications` | 0 | Match rules → queue sends |
| `notification:send` | `notifications` | 2 + exponential backoff (5s base) | Policy → resolve → render → channel |

Override queue name with `jobs.queue`.

## Failure model

- **Retriable** provider errors (timeout, rate limit, unavailable, temporary): handler **throws** → Payload retries the same job  
- **Terminal** (missing user, policy deny, skip): soft success with `status: 'skipped' | 'failed'` and a log row  
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
2. **`notification-logs`** — channel outcome, `fingerprint`, `providerResponse`, optional `meta.jobId` / `meta.testSend`  
3. **`notifications`** — in-app inbox rows  
4. **`observability.onDispatch`** — structured callback  

## Debugging checklist

1. Was `emitNotificationEvent` called with `userId`?  
2. Does a rule match `event` + enabled channels?  
3. Is the jobs runner draining `notifications`?  
4. Policy / preferences blocking? Inspect log `error` / status `skipped`  
5. Template missing for channel? Check resolve errors in job failure output  
