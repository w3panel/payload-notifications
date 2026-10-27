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

Completed fingerprints (`sent` | `stored` | `skipped`) block duplicate deliveries. Persist via `notification-logs.fingerprint`.

## Helpers

```ts
import {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from '@wtree/payload-notifications'
```

`classifyDispatchFailure` accepts `Error` or string; marks timeout / temporary / rate limit / unavailable as `retriable`.
