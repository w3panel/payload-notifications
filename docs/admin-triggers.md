# Admin-created triggers

Administrators can build, test, publish and version notification triggers in Payload Admin under
**Notification Triggers**, without writing code. Admin triggers run on the same engine as code
triggers, as described in [triggers.md](./triggers.md) and [automation.md](./automation.md).

> After installing or upgrading, regenerate the Payload **import map** so the admin components
> resolve: `@wtree/payload-notifications/admin#TriggerBuilderField`, `#CodeTriggersList` and
> `#TemplateStudioField`.

## What developers control

Admins can only pick from what the developer registers:

| Admins pick from | Registered with |
| --- | --- |
| Application events | `events` (label, schema, `samplePayload`) |
| Collection changes | `collectionEvents` (collections, operations, captured fields) |
| Collections and fields for data sources | `data.collections` |
| Resolvers and computed values | `dataResolvers`, `computed` |
| Recipient resolvers and named queries | `recipientResolvers`, `recipientQueries` |
| Custom conditions | `conditions` |
| Templates | the code registry and `notification-templates` |
| Channels | `channels` |

Nothing an admin enters runs as code: conditions are JSON, and resolvers are referenced by name.

## Permissions

```ts
notificationsPlugin({
  access: {
    isAdmin: ({ req }) => req.user?.roles?.includes('admin'), // default for all three below
    manageTriggers: ({ req }) => …,  // create / edit / validate / customize, registry & code list
    publishTriggers: ({ req }) => …, // publish, enable, disable, archive, rollback
    testSend: ({ req }) => …,        // "Send test to me" and template test-send
  },
})
```

If you don't configure these, `isAdmin` lets in any logged-in user. Pass a role check in
production.

## Trigger Builder

Open a trigger and work through the steps:

1. **Source:** a registered application event, or a configured collection and operation.
2. **Conditions:** AND / OR groups of rules, with suggestions for event payload fields, captured
   `doc` / `previous` fields and data-source fields. "Changed / changed to / changed from" are only
   offered for `doc.*` fields of collection triggers. Registered custom conditions can be added.
3. **Data sources:** collection lookups (by ID or relationship) over allowlisted fields, the
   triggering document, resolvers and computed values.
4. **Recipients:** the event user, a user found in the data, a fixed email or phone, a role, or a
   registered resolver or query.
5. **Deliveries:** the channel, a template that has content for that channel, the recipient alias,
   and an optional "only send when…" condition per recipient.
6. **Schedule:** immediately, after a delay, at a time from the data, or relative to it. You can
   choose to re-check conditions when the delivery is due, and to skip the delivery if its time has
   passed. Classification is set here too.
7. **Test & publish:** run a test, send a test to yourself, then validate and publish.

Every step edits the trigger's JSON fields. The raw JSON is also shown under **Definition (JSON)**
for review or bulk edits.

## Lifecycle and versions

`draft → validated → published → disabled → archived`

| Action | Effect |
| --- | --- |
| Validate | Stores a validation report; a clean draft becomes `validated` |
| Publish | Validates, then saves an **immutable snapshot** as version N+1 in `notification-trigger-versions` and makes it live |
| Disable / Enable | Stops / resumes matching (same version) |
| Archive | Retires the trigger |
| Roll back | Copies version N back into the trigger and publishes it as a new version |

- **What runs:** the engine only runs published snapshots. Editing a published trigger flags
  **unpublished changes**; the live version is unaffected until you publish again.
- **Queued deliveries:** these keep the version that created them (`triggerVersion`). Set
  `adminTriggers.cancelQueuedOnDisable: true` to cancel them when a trigger is disabled or archived.
- **Lifecycle API:** actions are only available through
  `POST /api/notification-triggers/:id/lifecycle { action, version? }`. The `status` and `version`
  fields are server-managed.
- **Caching:** published admin triggers are cached per server instance for
  `adminTriggers.cacheTtlMs` (default 30 s). Lifecycle actions refresh the instance that ran them;
  other instances pick changes up within the TTL.

### Publish validation

Publishing is blocked when the report has errors:

- the source event isn't registered, or the collection or operation isn't configured
- the slug collides with a code trigger
- the precedence rules for overrides aren't met
- data sources use collections or fields that aren't allowlisted, contain a cycle, or use
  unregistered resolvers
- recipients or deliveries are invalid, or a delivery uses a channel that isn't enabled
- conditions reference fields that aren't loaded or captured
- a schedule is invalid
- a template doesn't exist or has no **active** content for the delivery's channel
- a template's **required variables** aren't available from the trigger's context

Warnings don't block publishing. They cover:

- a missing classification
- marketing triggers without `quietHours`
- payload paths that aren't in the sample payload

## Code triggers in admin

Above the trigger list, **Triggers defined in code** shows every code trigger and legacy rule with
its precedence policy:

- **Independent:** admin triggers on the same event run alongside it.
- **Managed:** **Customize** creates a draft admin record (`overrides: <code slug>`), pre-filled
  with the fields the developer marked overridable. Once published, it replaces those fields on the
  code trigger.
- **🔒 Enforced:** read-only.

## Testing

**Run test** (`POST /api/payload-notifications/triggers/test`) evaluates the current form values,
saved or not. It uses the event's registered sample payload (or JSON you edit), or a real document
for collection triggers, and loads data with your own access. It shows:

- the redacted context (`data.redact` paths and sensitive fields are masked)
- recipients with masked destinations
- every planned delivery, with its rendered subject and text

Nothing is written.

**Send test to me** sends each channel and template once to **your own** email, phone or in-app
inbox. Other recipients never receive anything. The deliveries are stored with `test: true` and
unique keys, so they don't affect duplicate protection for real events. Resolvers still run, so
keep them free of side effects.
