# Observability

## `onEvent`: every lifecycle stage

```ts
observability: {
  onEvent: async (event, { payload, idempotencyKey }) => {
    // event.type === 'notification.lifecycle'
    // stage: matched | conditions-not-met | planned | duplicate | skipped | sent | retrying
    //        | failed | unknown | cancelled | delivered
    metrics.increment(`notifications.${event.stage}`, { trigger: event.trigger, channel: event.channel })
  },
  log: true, // also write each stage to payload.logger (warn for failed / unknown)
},
```

Each event carries:

- `eventId`, `trigger`, `triggerSource`, `triggerVersion`
- `deliveryId`, `channel`, `recipient` (`user:<id>`, or a masked email or phone)
- `reason`, `provider`, `providerMessageId`, `attempt`, `durationMs`

The second argument is `{ payload, idempotencyKey? }`: the Payload instance, and the delivery's
idempotency key when the event concerns one delivery. The key can contain an address with the
default `deliveries.key`, so it is never part of the event or the `log` output.

- `conditions-not-met`: a matched trigger's conditions or `condition` function did not hold at
  planning time; `reason` says which. Nothing was planned.
- `duplicate`: planning found a delivery holding this delivery's key; `deliveryId` is that
  delivery, `trigger` the one that was not planned.

Errors thrown by the hook are logged and never affect sending.

## `onDispatch`

```ts
observability: {
  onDispatch: async (event) => {
    // event.type === 'notification.dispatch'
    console.info(event.status, event.channel, event.fingerprint, event.reason)
  },
},
```

Emitted for skip / send / store / fail outcomes (including duplicate fingerprint skips). Delivery-based sends add `eventId`, `trigger`, `triggerSource`, `deliveryId`, `stage` and `durationMs`.

## Fingerprints

`buildDeliveryFingerprint` keys on `userId`, `channel`, `event`, `template`, `idempotencyKey`.

Trigger-based sends are deduplicated by the unique `notification-deliveries.idempotencyKey` (the delivery's key is also used as the log `fingerprint`). For direct `queueNotificationSend` calls, completed fingerprints (`sent` | `stored` | `skipped`) in `notification-logs` block duplicates.

## Helpers

```ts
import {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from '@wtree/payload-notifications'
```

`classifyDispatchFailure` accepts `Error` or string; marks timeout / temporary / rate limit / unavailable as `retriable`.
