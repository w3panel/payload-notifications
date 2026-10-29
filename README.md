# @wtree/payload-notifications

Production-ready notifications plugin for Payload CMS with an event-driven, multi-channel architecture for email, WhatsApp, SMS, and in-app delivery.

## Features
- Event-to-rule notification dispatch through Payload jobs (named `notifications` queue)
- Deep Payload job tasks with input/output schemas, exponential retries, concurrency keys, and `onFail` hooks
- Channel implementations for email, WhatsApp, SMS, and in-app notifications
- **Real provider integrations**: Meta WhatsApp Cloud API, Twilio SMS, and Twilio WhatsApp
- Delivery log persistence and in-app notification storage with resolved template content
- Template registry + DB `notification-templates` with admin **template studio** (preview / test-send)
- Registry → DB seeding (`seedTemplatesFromRegistry` / `templates.seedOnInit`)
- Preference mapping, consent enforcement, and custom policy hooks
- Reliability helpers for idempotency, retry classification, throw-to-retry dispatch, and observability hooks
- Fail-fast configuration validation with clear error messages
- Bun-based test suite, contributor guidance, CI expectations, and release-readiness docs

## Documentation

| Guide | Topic |
|-------|--------|
| [docs/getting-started.md](docs/getting-started.md) | Install, first emit, jobs queue |
| [docs/end-to-end.md](docs/end-to-end.md) | Full dynamic checklist |
| [docs/templates.md](docs/templates.md) | Registry vs DB, engine syntax |
| [docs/admin-templates.md](docs/admin-templates.md) | Preview, test-send, import map |
| [docs/events.md](docs/events.md) | Event registry, schemas, emitting |
| [docs/data-sources.md](docs/data-sources.md) | Collections, relationships, resolvers in templates |
| [docs/triggers.md](docs/triggers.md) | Triggers, recipients, deliveries, code/admin precedence |
| [docs/automation.md](docs/automation.md) | Conditions, collection events, scheduling, guards, event inbox |
| [docs/rules-and-triggers.md](docs/rules-and-triggers.md) | Legacy rules, `defineTrigger`, domain hooks |
| [docs/seeding.md](docs/seeding.md) | Seed templates from registry |
| [docs/jobs-and-operations.md](docs/jobs-and-operations.md) | Queue ops, retries, debugging |
| [docs/preferences-and-policy.md](docs/preferences-and-policy.md) | Consent + `canSend` |
| [docs/observability.md](docs/observability.md) | Fingerprints + `onDispatch` |
| [docs/options-reference.md](docs/options-reference.md) | Full options table |
| [docs/providers.md](docs/providers.md) | Meta / Twilio providers |

## Installation
```bash
bun add @wtree/payload-notifications
```

After install/upgrade, regenerate the Payload **import map** so `@wtree/payload-notifications/admin#TemplateStudioField` resolves.

## Quick start
```ts
import { notificationsPlugin } from '@wtree/payload-notifications'

export default buildConfig({
  plugins: [
    notificationsPlugin({
      channels: ['email', 'inapp'],
      providers: {
        email: {
          defaultFromAddress: 'noreply@example.com',
        },
      },
      rules: [
        {
          event: 'order.paid',
          channels: ['email', 'inapp'],
          template: 'order.paid',
        },
      ],
      observability: {
        onDispatch: async (event) => {
          console.info(event)
        },
      },
    }),
  ],
})
```

## Configuration
### Channels

Default channels: `['email', 'inapp']`. These work out of the box with Payload's built-in email adapter and the notifications collection.

To enable SMS or WhatsApp, you must explicitly add them and provide provider credentials:

```ts
notificationsPlugin({
  channels: ['email', 'sms', 'inapp'],
  providers: {
    sms: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_SMS_FROM,
    },
  },
})
```

Available channels:
- `email` — via Payload CMS built-in email
- `whatsapp` — via Meta Cloud API or Twilio
- `sms` — via Twilio
- `inapp` — stored in the notifications collection

### Jobs processing

The plugin registers two Payload job tasks automatically on the **`notifications`** queue (override with `jobs.queue`):

- `notification:process-event` — matches triggers (and rules), resolves data and recipients, creates `notification-deliveries` records and queues one send per delivery (`retries: 0`)
- `notification:send` — sends one delivery (`retries: 2` with exponential backoff)

Task configs include `inputSchema` / `outputSchema`, per-delivery `concurrency`, and `onFail` handling that marks the delivery failed. Handlers are wired via `onInit` and work out of the box.

**Retry semantics**
- Retriable provider failures **throw** so Payload retries the **same** job (backoff / `waitUntil` / `hasError`).
- Terminal outcomes (missing user, policy deny, skipped) return succeeded output with `status: 'skipped' | 'failed'` — they are not re-queued.
- Do not force `state: 'succeeded'` in a host handler override when a send should retry.

**Running the queue**
- Long-lived hosts: configure `jobs.autoRun` for `queue: 'notifications'`.
- Serverless (Vercel): skip `autoRun`; invoke `/api/payload-jobs/run?queue=notifications` on a cron with `CRON_SECRET` (or equivalent). See Payload's [jobs documentation](https://payloadcms.com/docs/jobs-queue/overview).

## Supported providers

### Meta WhatsApp Cloud API

Send WhatsApp messages through the [Meta Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api). This is the recommended approach for WhatsApp — it uses Meta's official API directly without a third-party intermediary.

**Prerequisites:**
1. A [Meta Business account](https://business.facebook.com/) with a verified WhatsApp Business Profile.
2. A registered WhatsApp Business phone number and its Phone Number ID (found in the Meta App Dashboard under WhatsApp > API Setup).
3. A permanent System User access token with the `whatsapp_business_messaging` permission (or a temporary token for testing).

**Configuration:**
```ts
notificationsPlugin({
  channels: ['whatsapp'],
  providers: {
    whatsapp: {
      provider: 'meta',
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    },
  },
})
```

**Environment variables:**
| Variable | Description |
|---|---|
| `META_WHATSAPP_ACCESS_TOKEN` | System User access token with `whatsapp_business_messaging` permission |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID from the Meta App Dashboard |

**Limitations:**
- Only text messages are supported in this release. Template messages, media, interactive buttons, and list messages are not yet supported.
- The Meta Cloud API has rate limits that vary by tier. See [Meta's throughput documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/overview#throughput).
- Messages to users must be initiated within 24 hours of the user's last message, or you must use a pre-approved message template (Meta policy).
- The access token must be kept secure. Use environment variables, never hardcode tokens.

### Twilio SMS

Send SMS messages through [Twilio's Programmable Messaging API](https://www.twilio.com/docs/messaging).

**Configuration:**
```ts
notificationsPlugin({
  channels: ['sms'],
  providers: {
    sms: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_SMS_FROM,
    },
  },
})
```

**Environment variables:**
| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_SMS_FROM` | Sender phone number in E.164 format (e.g. `+15551234567`) |

### Twilio WhatsApp

Send WhatsApp messages through [Twilio's WhatsApp API](https://www.twilio.com/docs/whatsapp).

**Configuration:**
```ts
notificationsPlugin({
  channels: ['whatsapp'],
  providers: {
    whatsapp: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_WHATSAPP_FROM,
    },
  },
})
```

**Environment variables:**
| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp sender number with `whatsapp:` prefix (e.g. `whatsapp:+15551234567`) |

### Email (built-in)

Email uses Payload CMS's built-in email system. No external provider is needed — configure your SMTP/transport in the Payload config as usual.

```ts
notificationsPlugin({
  channels: ['email'],
  providers: {
    email: {
      defaultFromAddress: 'noreply@example.com',
      defaultFromName: 'My App',
    },
  },
})
```

### In-App (built-in)

In-app notifications are stored in the `notifications` collection and require no external provider.

### Template registry
Templates resolve by event key and channel, and can be overridden without modifying core internals. In-app notifications persist the resolved and token-replaced `title` and `body` from the template definition.

```ts
const config = {
  templates: {
    registry: {
      'order.shipped': {
        email: {
          subject: 'Order {{ payload.orderId }} shipped',
          body: 'Tracking: {{ payload.trackingNumber }}',
        },
        inapp: {
          title: 'Order shipped',
          body: 'Order {{ payload.orderId }} has shipped.',
        },
        whatsapp: 'Order {{ payload.orderId }} shipped. Tracking {{ payload.trackingNumber }}.',
      },
    },
  },
}
```

Supported tokens: `{{ event }}`, `{{ userId }}`, `{{ payload.key }}` (supports dot-notation for nested values).

### Preferences, policy, and observability
```ts
const config = {
  preferences: {
    fields: {
      channels: 'notificationPreferences.channels',
      marketingConsent: 'notificationPreferences.marketing',
    },
  },
  policy: {
    canSend: ({ channel, classification, user }) => ({
      allow: !(channel === 'sms' && classification === 'marketing' && user.plan === 'free'),
      reason: 'SMS marketing disabled for free plan',
    }),
  },
  observability: {
    onDispatch: async (event) => {
      console.log(event.type, event.status, event.fingerprint)
    },
  },
}
```

## Provider configuration reference

| Provider | Channel | Required fields |
|---|---|---|
| `meta` | `whatsapp` | `accessToken`, `phoneNumberId` |
| `twilio` | `whatsapp` | `accountSid`, `authToken`, `from` |
| `twilio` | `sms` | `accountSid`, `authToken`, `from` |

## Reliability helpers
The package exposes helpers to support retry-safe delivery and structured observability.

- `buildDeliveryFingerprint(input)` creates a deterministic deduplication key stored on `notification-logs.fingerprint`.
- `classifyDispatchFailure(error)` marks failures as `retriable` or `terminal` (accepts `Error` or string).
- `createObservabilityEvent(input)` shapes structured monitoring payloads.
- Trigger-based sends are deduplicated by the unique `notification-deliveries.idempotencyKey`; direct sends block duplicates from already-completed fingerprints.
- Retriable failures throw into Payload job retries (2 additional attempts, exponential backoff from 5s).

## Testing and CI
```bash
bun test
bun run check
```

See `docs/testing-strategy.md` for coverage expectations and CI guidance.

## Common flows
Starter templates are included for:
- `order.paid`
- `order.shipped`
- `auth.magic-link`

## Migration from 0.1.x

### Breaking changes

1. **Default channels changed** from `['email', 'whatsapp', 'sms', 'inapp']` to `['email', 'inapp']`. If you relied on the old defaults, explicitly pass the channels you need.

2. **Fail-fast validation** is now run at plugin creation time. Previously, some invalid configurations (like enabling SMS without a provider) would only fail at runtime. Now they throw immediately with a `payload-notifications:` prefixed message.

3. **In-app notification content** now stores resolved template `title` and `message` instead of generic placeholders. If you parse stored notification text, update any expectations.

### Migration steps

If you currently send notifications directly from hooks or services, migrate by:
1. Emitting domain events into the plugin job pipeline.
2. Moving per-channel message text into the template registry.
3. Applying preference and policy checks centrally instead of inline.
4. Using logs and in-app collections for auditability.
5. Attaching an observability hook for metrics or external monitoring.

## Release checklist
- Run tests and fix regressions.
- Verify provider configuration and published exports.
- Review README and examples.
- Confirm release notes and version bump.
- Validate package contents before publishing.
