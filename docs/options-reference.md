# Options reference

`notificationsPlugin(options: NotificationsPluginOptions)`

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Disable plugin registration when `false` |
| `channels` | `['email','inapp']` | Enabled channels; SMS/WhatsApp need providers |
| `userCollectionSlug` | `'users'` | User collection for prefs / recipients |
| `collections.notifications` | `'notifications'` | In-app inbox slug |
| `collections.logs` | `'notification-logs'` | Delivery log slug |
| `collections.templates` | `'notification-templates'` | Template slug |
| `jobs.queue` | `'notifications'` | Payload jobs queue name |
| `templates.registry` | package starters | Code templates keyed by slug |
| `templates.seedOnInit` | `false` | Seed missing DB templates from registry on init |
| `templates.email` / `whatsapp` / `sms` | — | Legacy string keys (prefer registry) |
| `providers.email` | — | `defaultFromAddress`, `defaultFromName` |
| `providers.whatsapp` | — | `meta` or `twilio` credentials |
| `providers.sms` | — | `twilio` credentials |
| `preferences.fields.channels` | `notificationPreferences.channels` | Dot-path on user |
| `preferences.fields.marketingConsent` | `notificationPreferences.marketing` | Dot-path on user |
| `policy.canSend` | — | Custom allow/deny hook |
| `observability.onDispatch` | — | Dispatch telemetry hook |
| `rules` | `[]` | Event → channels → template fan-out (optional `data.sources`) |
| `events` | `{}` | Registered application events (`label`, `description`, `classification`, `schema`, `samplePayload`, `docsUrl`) — see [events.md](./events.md) |
| `eventsStrict` | `false` | Reject emits for events missing from `events` |
| `data.collections` | `{}` | Collections/fields data sources may read — see [data-sources.md](./data-sources.md) |
| `data.redact` | `[]` | Dot paths masked in previews, inspectors and logs |
| `data.sensitiveFields` | `[]` | Extra field names added to the sensitive-field denylist |
| `dataResolvers` | `{}` | Registered resolvers (`handler`, `label`, `input`, `output`, `timeoutMs`, `fields`) |
| `computed` | `{}` | Registered pure functions over the resolved context |

Fail-fast validation throws `payload-notifications: …` when SMS/WhatsApp lack providers or channels are empty/unknown.

See [providers.md](./providers.md) for Meta/Twilio details.
