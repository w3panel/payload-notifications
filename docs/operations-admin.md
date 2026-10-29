# Operations admin

The plugin adds an operations area to the Payload admin. It covers deliveries, an overview dashboard, provider status and permissions.

## Navigation

The plugin's collections and the brand theme are grouped under **Notifications**, in this order: Triggers, Templates, Template Partials, Deliveries, attempt logs, Events, Inbox, Preferences and Suppressions.

- Two nav links open the dashboard's **Overview** and **Providers & settings** tabs.
- A group the host sets on a collection wins.
- `admin.group` renames the group; `false` leaves the collections ungrouped.
- `admin.navLinks: false` hides the links.

## Overview dashboard

The overview appears on the Payload dashboard; `admin.dashboard: false` removes it. It covers the last 24 hours, 7 days or 30 days:

- Events received and the trigger match rate. These need `eventsInbox: true`; without the inbox, only events that produced deliveries are counted.
- Deliveries by status, channel and trigger, and per day.
- Skip and cancel reasons, and the latest failures (linked to the delivery).
- Provider attempts, failure rate, and average and p95 latency.
- Pending jobs in the notifications queue.

Data: `GET /api/payload-notifications/stats?days=7`. It needs `access.viewDeliveries` and is tenant-scoped. Large windows are sampled: at most 5000 records per collection are counted.

## Deliveries

The **Deliveries** list can be searched by event, trigger, recipient, masked destination and event ID. It can be filtered with Payload's filters by status, channel, trigger, origin (`triggerOrigin`), recipient and date.

Opening a delivery shows the **inspector**:
- Status, skip reason and last error.
- Every attempt, with the provider, message ID, duration, error and a redacted provider response.
- Fallback deliveries.
- The context captured at planning, redacted with `data.redact` and the sensitive-field list.

It has two actions:

| Action | Allowed for | Effect |
|---|---|---|
| **Retry** | `failed`, and `unknown` after a confirmation | Re-queued on the same record and idempotency key, with one more attempt allowed. An `unknown` outcome may already have been delivered. |
| **Cancel delivery** | `planned`, `queued` | Set to `cancelled`; the queued send job skips it. |

API:
- `GET /api/notification-deliveries/:id/inspect` needs `viewDeliveries`.
- `POST /api/notification-deliveries/:id/retry { confirmUnknown? }` and `POST …/:id/cancel` need `retryDeliveries`.

Records are loaded with the caller's access, so tenant scoping applies.

## Providers & settings

The tab shows each channel's provider: built-in or custom, its capabilities, configuration problems, which credentials are set, and its status webhook URL.

- **Secrets:** shown as ✓ / ✗ only, never their values.
- **Test connection** checks credentials without sending:
  - Twilio: account lookup.
  - Meta: phone-number lookup, which shows the number, verified name and quality.
  - Email: whether Payload has an email adapter, other than the console adapter.
  - Custom providers can implement `testConnection()`.

Queue, retries, reconcile and retention schedules, events inbox, preferences, quiet hours, tenancy and webhook signature settings are listed read-only, because they are defined in code.

API:
- `GET /api/payload-notifications/settings` needs `viewDeliveries`.
- `POST /api/payload-notifications/providers/:channel/test` needs `testSend`.

## Permissions

Each check defaults to `access.isAdmin`, which defaults to any logged-in user. Pass role checks for real deployments.

| Check | Guards |
|---|---|
| `manageTriggers` | Admin triggers, the event and data-source pickers |
| `publishTriggers` | Publish, enable, disable, archive and roll back triggers |
| `manageTemplates` | Create and edit templates and partials; preview, compile-design and variables endpoints |
| `publishTemplates` | Publish and roll back templates, WhatsApp approval sync, the brand theme |
| `testSend` | Test sends (to yourself) and provider connection tests |
| `viewDeliveries` | Deliveries, attempt logs, events, overview and settings |
| `retryDeliveries` | Retry and cancel deliveries |
| `managePreferences` | Other users' preferences, and suppressions |
| `rawHtml` | Raw HTML blocks in visual designs (default: nobody) |

```ts
notificationsPlugin({
  access: {
    isAdmin: ({ req }) => req.user?.role === 'admin',
    viewDeliveries: ({ req }) => ['admin', 'support'].includes(req.user?.role),
    retryDeliveries: ({ req }) => req.user?.role === 'admin',
  },
})
```

Access functions passed in a collection override (`overrides.deliveries.access.read`, …) take precedence.

### Tenants

With `tenancy: { field, userField }`:
- Deliveries record the event's tenant.
- A user whose `userField` is set sees only that tenant's deliveries, attempt logs (by `delivery.tenant`), events and overview numbers.
- Users without a tenant (platform admins) see everything.

Triggers, templates, partials and the theme are app-wide configuration and are shared.
