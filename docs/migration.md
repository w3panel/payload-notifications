# Migrating from 0.3.x

0.3.x configurations keep working; a test suite runs a 0.3.x config on a real Payload instance in CI. Upgrading is mostly a database migration. Everything else is opt-in.

## 1. Upgrade

```bash
bun add @wtree/payload-notifications@latest
```

- **Payload:** `^3.92.0`, or `>=4.0.0-beta.4 <5` (`@wtree/payload-notifications@next` tracks Payload 4 betas first). See [COMPATIBILITY.md](../COMPATIBILITY.md).
- **Node:** see `engines` in `package.json`.
- **Admin import map:** regenerate it so the new admin components resolve (`TemplateStudioField`, `PartialDesignerField`, `TriggerBuilderField`, `CodeTriggersList`, `DeliveryInspectorField`, `NotificationsDashboard`, `NotificationsNavLinks`).

## 2. Database

New collections:

| Collection | Purpose | Created when |
|---|---|---|
| `notification-deliveries` | One row per message (recipient × channel × trigger) | always |
| `notification-triggers`, `notification-trigger-versions` | Admin-created triggers and their published snapshots | always |
| `notification-template-versions` | Published template snapshots | always |
| `notification-template-partials` | Reusable sections for visual emails | always |
| `notification-suppressions` | Bounced, complained and STOP destinations | always |
| `notification-preferences` | Per user × channel × category preferences | `preferences.mode: 'collection'` |
| `notification-events` | Event inbox for audit and replay | `eventsInbox: true` |

There is also a new global, `notification-theme` (the brand theme for visual emails).

New fields:
- **`notification-templates`:** `locale`, `version`, `source`, `seedHash`, `hasUnpublishedChanges`, `whatsappTemplateStatus`, `whatsappTemplateCheckedAt`, `email.editor`, `email.design`, `email.preheader`, the `inapp.*` fields (`actionUrl`, `icon`, `priority`) and the `whatsapp.hsm*` fields.
- **`notification-logs`:** `delivery`, `outcome`, `durationMs`, `attempt`, `failureClassification`, `templateSlug`, `templateVersion`, `renderDurationMs`.

**Migrations:**
- **SQL (Postgres, SQLite, D1):** create and run one after upgrading:

  ```bash
  bunx payload migrate:create notifications-1-0
  bunx payload migrate
  ```

  On Cloudflare D1, apply the generated migration the same way you apply your other migrations, for example in your deploy step.
- **MongoDB:** needs no migration.
- **Payload 3 with several job workers:** to keep one send per delivery at a time, also set `jobs.enableConcurrencyControl: true`. That needs a migration too.

**No data conversion is needed:**
- Existing templates keep working. Active templates published before snapshots existed render from the document, and the next publish creates their first snapshot.
- Existing logs stay where they are.

## 3. What keeps working unchanged

| 0.3.x | 1.0 behaviour |
|---|---|
| `rules: [{ event, channels, template, condition, templateOverrides, data }]` | Each rule runs as a code trigger `rule-<index>-<event>`: one delivery per channel to the event's user |
| `defineTrigger({ event, channels, template })` | Same as a rule |
| `templates.registry` / `templates.localized` | Used when no active DB template matches |
| `preferences.fields` (`channels`, `marketingConsent`) | Default `preferences.mode: 'userFields'` |
| `queueNotificationSend` / `sendNotification` | Direct sends without a delivery record (legacy path) |
| `observability.onDispatch` | Still called for every send |
| `emitNotificationEvent` | Same API; now also validates registered events and fans out to triggers |

## 4. Recommended moves (opt-in)

### Rules → triggers

Triggers add recipients other than the event user, conditions, data sources, schedules, dedupe, retries, fallbacks and admin overrides.

```ts
// 0.3.x
rules: [{ event: 'order.paid', channels: ['email', 'inapp'], template: 'order.paid' }]

// 1.0
triggers: [
  defineTrigger({
    slug: 'order-paid',
    event: 'order.paid',
    recipients: [{ type: 'eventUser', alias: 'customer' }],
    deliveries: [
      { channel: 'email', template: 'order.paid', recipient: 'customer' },
      { channel: 'inapp', template: 'order.paid', recipient: 'customer' },
    ],
    dedupe: { key: 'order.paid:{{ payload.orderId }}' },
  }),
]
```

Keep the rule's event and template; move `condition` to `condition` (or JSON `conditions`), and `data` to `data.sources`. Remove the rule once the trigger is live, or both will send.

### Direct sends → events

Replace `queueNotificationSend` calls with `emitNotificationEvent`. Each delivery then gets a record you can inspect, retry and cancel, plus dedupe, scheduling and admin control.

### Logs → deliveries and attempts

- A **delivery** (`notification-deliveries`) is one message: status, schedule, recipient and template version.
- **Attempt logs** (`notification-logs`) record each try, with outcome, duration and provider response, and link to their delivery.
- Dashboards and reports that counted logs should count deliveries; the new overview does.
- Legacy direct sends still write logs only.

### Preferences in a collection

`preferences.mode: 'collection'` stores preferences per user × channel × category and adds one-click unsubscribe. To copy 0.3.x user-field preferences over, run a one-off script:

```ts
// scripts/migrate-preferences.ts — run once with your Payload config.
const users = await payload.find({ collection: 'users', limit: 0, depth: 0, overrideAccess: true })
for (const user of users.docs) {
  const channels = (user.notificationChannels ?? {}) as Record<string, boolean>
  for (const [channel, enabled] of Object.entries(channels)) {
    if (enabled === false) {
      await payload.create({
        collection: 'notification-preferences',
        data: { user: user.id, channel, category: '*', enabled: false },
        overrideAccess: true,
      })
    }
  }
  if (user.marketingOptIn === false) {
    await payload.create({
      collection: 'notification-preferences',
      data: { user: user.id, channel: '*', category: 'marketing', enabled: false },
      overrideAccess: true,
    })
  }
}
```

### Visual emails

Existing templates stay in code mode. To redesign one, set **Email → Editor** to **Visual designer**. Saving then replaces the HTML and text with the design.

## 5. Behaviour changes to check

- **Permissions:** the new `access.*` checks default to `access.isAdmin`, which defaults to any logged-in user, so nothing is locked by default. Set role checks, especially `viewDeliveries`, `manageTemplates` and `testSend`. See [operations-admin.md](./operations-admin.md#permissions).
- **Raw HTML:** raw HTML blocks are closed (`access.rawHtml` defaults to nobody).
- **Template test-send** goes only to the signed-in user, marked `[Test]`.
- **`templates.emailLayout`** does not wrap visual designs, because they are full documents.
- **Admin navigation:** the plugin's collections move under a **Notifications** nav group (`admin.group: false` to opt out), and an overview appears on the dashboard (`admin.dashboard: false`).
- **Payload 4:** the Local API no longer bypasses access by default. Code that reads the plugin's collections must pass `overrideAccess: true` or a `user`.
