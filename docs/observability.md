# Observability

## `onDispatch`

```ts
observability: {
  onDispatch: async (event) => {
    // event.type === 'notification.dispatch'
    console.info(event.status, event.channel, event.fingerprint, event.reason)
  },
},
```

Emitted for skip / send / store / fail outcomes (including duplicate fingerprint skips).

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
