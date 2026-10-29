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
| `collections.deliveries` | `'notification-deliveries'` | Delivery records slug |
| `collections.events` | `'notification-events'` | Event inbox slug (with `eventsInbox`) |
| `collections.triggers` | `'notification-triggers'` | Admin-created triggers |
| `collections.triggerVersions` | `'notification-trigger-versions'` | Published admin trigger snapshots |
| `collections.preferences` | `'notification-preferences'` | User preferences (collection mode) |
| `collections.suppressions` | `'notification-suppressions'` | Suppressed destinations |
| `collections.templateVersions` | `'notification-template-versions'` | Published template snapshots |
| `jobs.queue` | `'notifications'` | Payload jobs queue name |
| `templates.registry` | package starters | Code templates keyed by slug |
| `templates.seedOnInit` | `false` | Seed missing DB templates from registry on init |
| `templates.starterPack` | — | `true` or `['ecommerce','auth','saas']`: 20 events + templates — see [templates.md](./templates.md#starter-pack) |
| `templates.defaultLocale` | — | Locale used when a recipient has none |
| `templates.localized` | `{}` | Per-locale code registry variants |
| `templates.emailLayout` | — | Layout wrapping every HTML email (template string or function) |
| `templates.shortenLink` | — | Shortens links in SMS / WhatsApp text |
| `templates.mediaCollection` | — | Upload collection for designer images and the theme logo — see [admin-templates.md](./admin-templates.md#media) |
| `templates.mediaBaseUrl` | `serverURL` | Origin for relative media URLs |
| `collections.partials` | `notification-template-partials` | Reusable sections for visual emails |
| `globals.theme` | `notification-theme` | Brand theme global for visual emails |
| `templates.email` / `whatsapp` / `sms` | — | Legacy string keys (prefer registry) |
| `providers.email` | — | `defaultFromAddress`, `defaultFromName` |
| `providers.whatsapp` | — | `meta` or `twilio` credentials (`businessAccountId` for Meta template approval sync) |
| `providers.sms` | — | `twilio` credentials |
| `providers.custom` | `{}` | Custom `NotificationProvider` per channel — see [reliability.md](./reliability.md#providers) |
| `providers.timeoutMs` | `30000` | Provider call timeout (timeouts are `unknown`, not retried) |
| `preferences.fields.channels` | `notificationPreferences.channels` | Dot-path on user |
| `preferences.fields.marketingConsent` | `notificationPreferences.marketing` | Dot-path on user |
| `preferences.mode` | `'userFields'` | `'collection'` uses `notification-preferences` — see [preferences-and-policy.md](./preferences-and-policy.md) |
| `preferences.mandatoryCategories` | `['transactional']` | Categories that ignore opt-outs (collection mode) |
| `preferences.marketingRequiresOptIn` | `false` | Marketing needs an explicit opt-in record |
| `preferences.unsubscribe` | — | `{ secret, baseUrl? }`: signed one-click unsubscribe links and headers |
| `policy.canSend` | — | Custom allow/deny hook |
| `observability.onDispatch` | — | Dispatch telemetry hook |
| `observability.onEvent` | — | Lifecycle events for every stage — see [observability.md](./observability.md) |
| `observability.log` | `false` | Structured `payload.logger` output per stage |
| `rules` | `[]` | Legacy event → channels → template fan-out (optional `data.sources`); compiled into triggers |
| `triggers` | `[]` | Code-defined triggers (`slug`, `source`/`event`, `data`, `recipients`, `deliveries`, `admin.policy`) — see [triggers.md](./triggers.md) |
| `recipients.destinationFields` | email `email`; sms `phone`/`phoneNumber`; whatsapp `whatsapp`/`phone`/`phoneNumber` | User fields read per destination (also `name`, `locale`, `timezone`) |
| `recipients.defaultCountryCode` | — | Prefix for phone numbers without a country code (e.g. `+91`) |
| `recipients.roleField` | `'roles'` | User field for `role` recipients |
| `recipients.maxPerEvent` | `100` | Recipient cap per trigger per event |
| `recipientResolvers` | `{}` | Registered recipient resolvers |
| `recipientQueries` | `{}` | Registered named user queries (`where`, `maxResults`) |
| `conditions` | `{}` | Registered custom conditions (`{ custom: name }` in JSON conditions) — see [automation.md](./automation.md) |
| `collectionEvents` | `{}` | Collections that emit `collection.<slug>.<operation>` events (`operations`, `capture`, `userField`, `onlyWhenCaptureChanges`) |
| `maxEventDepth` | `3` | Processing depth at which events stop being emitted (loop guard) |
| `tenancy` | — | `{ field, userField? }`: tenant-scoped lookups and role/query recipients |
| `quietHours` | — | `{ start, end, timezone?, classifications? }`: hold sends during local hours (marketing by default) |
| `eventsInbox` | `false` | Store emitted events in `notification-events` for audit and replay |
| `access.isAdmin` | any logged-in user | Default for the three checks below — see [admin-triggers.md](./admin-triggers.md) |
| `access.manageTriggers` | `isAdmin` | Create / edit / validate / customize admin triggers |
| `access.publishTriggers` | `isAdmin` | Publish, enable, disable, archive, roll back |
| `access.testSend` | `isAdmin` | Trigger test sends and template test-send (to the caller only) |
| `access.publishTemplates` | `isAdmin` | Publish / roll back templates, sync WhatsApp approval, edit the theme |
| `access.rawHtml` | nobody | Add or change raw HTML blocks in visual designs |
| `adminTriggers.cancelQueuedOnDisable` | `false` | Cancel queued deliveries when a trigger is disabled / archived |
| `adminTriggers.cacheTtlMs` | `30000` | Per-instance cache for published admin triggers |
| `reliability.attempts` / `backoff` / `jitter` | `3` / exponential 5s→1h / `true` | Default retry policy — see [reliability.md](./reliability.md) |
| `reliability.maxAttempts` | `10` | Cap for any trigger's attempts |
| `reliability.staleSendingMinutes` | `30` | Reconciliation threshold for stuck sends |
| `logs.storeRendered` | `false` | Store rendered subject / text on attempt logs |
| `webhooks.publicUrl` / `twilio` / `meta` | — | Provider webhook settings (signature verification) |
| `maintenance.reconcileCron` / `retentionCron` / `retention` | — | Scheduled reconcile / retention tasks |
| `events` | `{}` | Registered application events (`label`, `description`, `classification`, `schema`, `samplePayload`, `docsUrl`) — see [events.md](./events.md) |
| `eventsStrict` | `false` | Reject emits for events missing from `events` |
| `data.collections` | `{}` | Collections/fields data sources may read — see [data-sources.md](./data-sources.md) |
| `data.redact` | `[]` | Dot paths masked in previews, inspectors and logs |
| `data.sensitiveFields` | `[]` | Extra field names added to the sensitive-field denylist |
| `dataResolvers` | `{}` | Registered resolvers (`handler`, `label`, `input`, `output`, `timeoutMs`, `fields`) |
| `computed` | `{}` | Registered pure functions over the resolved context |

Fail-fast validation throws `payload-notifications: …` when SMS/WhatsApp lack providers or channels are empty/unknown.

See [providers.md](./providers.md) for Meta/Twilio details.
