# Implementation plan — notification automation framework

Turns the product plan (triggers, data sources, recipients, deliveries, reliability), the
**hybrid trigger system** (code-defined + admin-created triggers) and the **visual template
studio** into phased, PR-sized work items on top of the **current 0.3.x codebase**.
Each item has an ID (e.g. `2.3`); each phase is tracked as one GitHub issue (see
[Tracking](#tracking)).

Related: #30 (template engine + campaigns), #28 (real-Payload integration tests),
#27 (job runner / deployment guide).

---

## 0. Baseline — what exists today

| Area | Current state (0.3.2) | Gap vs. target |
| --- | --- | --- |
| Events | `emitNotificationEvent({ name, userId, payload, classification, idempotencyKey })` | No event ID, no event registry (label, schema, sample), no collection-hook events |
| Triggers | `rules: [{ event, channels, template, condition?, templateOverrides? }]` in config; `defineTrigger` is an alias | No slug, data sources, recipients, deliveries, versioning, admin-created triggers, precedence policy |
| Data | Template context is `{ event, userId, payload }` only | No collection lookups, relationships, resolvers |
| Recipients | Always `event.userId`, user loaded from `userCollectionSlug` | No multi-recipient, static/role/resolver recipients |
| Templates | DB-first (`active`, highest `version`) → code registry; Handlebars-subset engine with escaping; template studio preview/test-send (code mode only); seeding | No locale, no immutable published versions, **no visual editor**, no variable autocomplete from data sources |
| Jobs | `notification:process-event` → `notification:send` (2 retries, backoff) | No delivery records; send input carries everything |
| Idempotency | Fingerprint = `user::channel::event::template::idempotencyKey`, checked against logs | No event ID → repeated legit events can collide when no key is given; no DB uniqueness; no cross-source dedupe |
| Policy | Preference field mapping on user doc + `canSend` hook | No preferences collection, categories, suppression, quiet hours |
| Providers | Email (Payload), in-app, Twilio SMS, Meta/Twilio WhatsApp (text) | No provider interface with capabilities, no HSM templates, no webhooks |
| Observability | `onDispatch` hook + `notification-logs` | No delivery status lifecycle, metrics, dashboard |

Out of scope: campaigns / audiences / A/B tests (#30 phase 2) and the push channel. Both should
be built **on top of** the delivery engine below, not alongside it.

---

## Guiding decisions

1. **One engine, two ways to register triggers.** Code-defined and admin-created triggers share
   the event registry, trigger matcher, context builder, recipient engine, template engine,
   delivery pipeline and logs. They differ only in how definitions are registered and managed.
2. **Code defines capabilities; admins configure workflows within them.** Developers own event
   names/schemas, collection + field allowlists, resolvers, providers, mandatory consent/security
   policy and the list of overridable settings. Admins own activation, conditions, template and
   channel assignment, recipients, scheduling and retries within configured limits.
3. **Rules become a shorthand for triggers.** Every existing `NotificationRule` compiles to a
   code `TriggerDefinition` (one delivery per channel, recipient `event.userId`, template
   `rule.template`). Existing configs keep working unchanged.
4. **No executable admin input.** Admins pick from *registered* events, collections, fields,
   resolvers, recipient resolvers and condition functions. Conditions are a JSON operator tree.
5. **Explicit precedence, never silent merging.** Code and admin triggers are independent by
   default; an admin record may *manage* (override) a code trigger only via its stable slug and
   only for fields the developer marked overridable; code triggers can be *enforced*.
6. **Delivery records are the unit of work.** `process-event` plans deliveries; `send`
   processes exactly one delivery by ID. Legacy send input stays accepted.
7. **Context stays backward compatible.** `{{ event }}`, `{{ userId }}`, `{{ payload.x }}` keep
   resolving; new aliases (`order`, `customer`, …) sit alongside them.
8. **Visual templates compile to the same engine.** The visual editor stores a block document
   and compiles it to `htmlBody`/`textBody` using the existing Handlebars-subset syntax, so
   rendering, escaping and sending have a single implementation.
9. **Engine before UI.** Trigger Builder and visual editor come after the contracts and the
   first end-to-end workflow are stable.

---

## Phase 1 — Contracts, event registry and data context builder

Goal: typed contracts for events, triggers and data sources, plus a context builder that
resolves multi-collection data — usable from today's rule pipeline.

- **1.1 Split public types**
  - Move `src/types.ts` into `src/types/{events,triggers,data-sources,recipients,templates,providers,deliveries,options}.ts`, re-exported from `src/types/index.ts`.
  - Keep every currently exported type name; add `@deprecated` JSDoc only where renamed.
  - Acceptance: declaration output is a superset of 0.3.2 exports (API snapshot test).
- **1.2 Application event registry**
  - `events: { [name]: { label, description?, classification?, schema?, samplePayload?, docsUrl? } }`.
  - Add `eventId` (generated at emit when absent) and `occurredAt` to `NotificationEvent`.
  - Validate payload against `schema` at emit time (Standard Schema or validator function); unknown events allowed unless `eventsStrict: true`.
  - Event `classification` is the default for emits that omit it.
  - `listRegisteredEvents()` + admin endpoint for pickers (label, schema field paths, sample payload).
  - Document: emit only after the business action is confirmed, from trusted server code.
  - Acceptance: invalid payload throws at `emitNotificationEvent` with event name and path.
- **1.3 Data-source contract**
  - Source types: `event`, `document` (the triggering collection doc, Phase 3), `collection` (`lookup: id | relationship`, `fields`, `depth ≤ 2`, `required`), `resolver`, `computed` (registered pure function over context).
  - Collection + field allowlist: `data.collections: { orders: { fields: [...] } }`; admins can only reference allowlisted fields.
  - Startup validation: collection exists, fields exist and are allowlisted, depth/limit caps, alias uniqueness, reserved aliases (`event`, `payload`, `userId`, `trigger`, `recipient`, `doc`, `previous`).
  - Acceptance: misconfigured source fails `validateNormalizedOptions` with an actionable message.
- **1.4 Context builder (`src/data/buildContext.ts`)**
  - Topologically sort sources by `from` paths (`event.payload.orderId`, `order.customer`); detect cycles.
  - Collection resolver: `findByID`/`find` with `select` from `fields`, `depth`; `overrideAccess` configurable (default `true` server-side, documented).
  - Relationship resolver: populated objects, IDs, `hasMany` arrays (capped by `maxItems`, default 50).
  - Failure policy per source: `required` → stop with `skipped: data-missing`; optional → alias `null`; never fabricate values.
  - Output: `{ trigger, event, userId, payload, doc?, previous?, ...aliases }`.
  - Acceptance: `order → customer → store` example passes as a unit test with mocked Payload.
- **1.5 Resolver registry**
  - `dataResolvers: { [name]: { label, handler, input?, output?, timeoutMs?, description? } }` (bare function also accepted).
  - Enforce timeout (default 5 s), validate output when a schema is given, wrap errors with resolver name.
  - Expose registered resolvers (name, label, output field paths) for admin pickers — never their code.
  - Acceptance: timeout and invalid output produce a typed `ResolverError` and a log entry.
- **1.6 Sensitive-field protection**
  - Global denylist (`password`, `hash`, `salt`, `resetPasswordToken`, `apiKey`, `*token*`, `*secret*`) applied after every lookup and resolver.
  - `data.redact` paths masked in previews, inspectors and logs.
  - Acceptance: selecting `users.password` fails validation; a resolver returning `apiKey` is stripped.
- **1.7 Wire into today's pipeline**
  - Rules accept optional `data.sources`; `sendNotification` builds context before rendering.
  - Template preview endpoint accepts `sampleEvent` and runs the context builder in dry mode with a redacted context inspector.

## Phase 2 — Unified trigger engine, recipients and deliveries

Goal: one engine for all triggers, with the **order.paid → customer email + WhatsApp + in-app**
workflow running through trigger → data → recipients → delivery records → send.

- **2.1 `TriggerDefinition` + `defineTrigger` v2**
  - Fields: `slug` (stable ID), `name`, `source: { type: 'event', event } | { type: 'collection', collection, operation }`, `enabled`, `conditions?`, `data?`, `recipients`, `deliveries`, `schedule?`, `reliability?`, `classification?`, `dedupe?`.
  - `defineTrigger` accepts the legacy shape (`event`, `channels`, `template`) and v2; `rules` compiled via `ruleToTrigger()` with a generated slug.
  - Acceptance: all existing rule tests pass unchanged through the compiled path.
- **2.2 Trigger registry (hybrid)**
  - Single in-memory registry merging code triggers (`source: 'code'`) and published admin triggers (`source: 'admin'`, loaded from DB and cached; invalidated on publish/disable).
  - Code triggers stay in memory (not synced to DB) — one authoritative definition per trigger.
  - Slug collision between two code triggers fails at startup; admin slugs cannot reuse code slugs except as managed overrides (2.3).
- **2.3 Precedence policy**
  - Per code trigger `admin: 'independent' (default) | 'managed' | 'enforced'` and `overridable: ['enabled','deliveries','recipients','conditions','schedule','reliability']`.
  - `independent`: admin triggers on the same event run separately.
  - `managed`: an admin record with `overrides: <codeSlug>` replaces only the overridable fields; others come from code.
  - `enforced`: admins see it read-only and cannot disable or override.
  - Matching logs which policy applied; no silent merging.
  - Acceptance: tests for each policy, including override of a non-overridable field being rejected.
- **2.4 Trigger matching (`src/triggers/match.ts`)**
  - Match by source (event name, optional `order.*` wildcard / collection + operation), `enabled`, precedence.
  - Snapshot the matched trigger version into the process-event output.
- **2.5 Recipient engine (`src/recipients/`)**
  - Types: `eventUser`, `context` (path), `relationship`, `static` (email/phone), `role` (registered role query), `resolver` (registered `recipientResolvers`), `query` (registered named query with `maxResults`).
  - Canonical recipient: `{ recipientId?, user?, locale?, timezone?, destinations: { email?, sms?, whatsapp?, inapp? } }`.
  - Destination field mapping per channel; E.164 normalization for phones.
  - Dedupe by `recipientId`/destination; cap recipients per event (default 100).
  - Acceptance: customer + account manager + static ops email → three distinct recipients.
- **2.6 Delivery definitions**
  - `deliveries: [{ channel, template, recipient: alias | 'all', when?, fallback? }]`.
  - Validate channel enabled and template compatible with channel at startup / publish.
- **2.7 `notification-deliveries` collection**
  - Fields: `eventId`, `event`, `trigger` (slug), `triggerSource`, `triggerVersion`, `recipientId`, `destination` (masked), `channel`, `templateSlug`, `templateVersion`, `status` (`planned|queued|sending|sent|delivered|failed|skipped|cancelled|unknown`), `attempts`, `idempotencyKey` (unique index), `dedupeKey`, `providerMessageId`, `scheduledFor`, `sentAt`, `deliveredAt`, `lastError`, `skipReason`, `test`.
  - Admin access: read-only for admins except the retry action (Phase 8).
- **2.8 Job pipeline update**
  - `process-event`: match → pre-data conditions → build context → post-data conditions → resolve recipients → create deliveries (upsert on `idempotencyKey`) → queue `notification:send` with `{ deliveryId }`.
  - `notification:send`: load delivery → policy → render pinned template version → provider → update delivery + write attempt log.
  - Legacy `notification:send` input (no `deliveryId`) still works for `queueNotificationSend`.
  - Acceptance: re-running the same process-event job creates no new deliveries.
- **2.9 Reference workflow**
  - `examples/order-paid/` fixture with orders/users/stores collections, event definition, code trigger, three templates.
  - End-to-end test with mocked providers asserting deliveries, logs and rendered output.

## Phase 3 — Conditions, collection events and scheduling

- **3.1 Condition engine (`src/triggers/conditions.ts`)**
  - JSON tree: `{ all: [...] } | { any: [...] } | { not: ... } | { field, operator, value }`.
  - Operators: `equals`, `notEquals`, `in`, `notIn`, `greaterThan(OrEqual)`, `lessThan(OrEqual)`, `exists`, `contains`, `changed`, `changedTo`, `changedFrom`.
  - Registered custom conditions `conditions: { [name]: { label, handler } }`, referenced as `{ custom: name }`.
  - Field references validated against event schema / data-source field paths.
  - Pre-data (event/doc fields) and post-data (full context) evaluation points.
  - Legacy function `condition` still supported on code triggers only.
- **3.2 Collection event registration**
  - `collectionEvents: { orders: { operations: ['create','update','delete'], capture: ['status','total'], label? } }` — the developer-controlled list of collections admins may build triggers on.
  - Inject `afterChange` / `afterDelete` hooks only for configured collections, once, deterministically at config time; never at runtime.
  - Emit internal `collection.<slug>.<operation>` events carrying `doc` and `previous` limited to `capture` fields.
  - `document` data source exposes the triggering doc under a chosen alias (e.g. `order`).
  - `delete` supported only when `capture` fields are taken from `doc` before deletion; documented limits.
  - Acceptance: updating an order's notes does not fire a trigger with `changedTo status=paid`.
- **3.3 Recursion and safety guards**
  - Skip the plugin's own collections; honour `req.context.skipNotifications`; depth guard for hook-triggered writes.
  - Respect tenant scope fields when configured (`tenancy.field`).
  - Document: prefer explicit application events for business-critical actions (payments).
- **3.4 Transactional safety**
  - Queue event jobs with the hook's `req` so they join the transaction; document outbox behaviour per adapter.
  - Optional `notification-events` inbox (`eventsInbox: true`) for audit and replay.
- **3.5 Scheduling**
  - `schedule: { type: 'immediate' | 'delay' | 'at' | 'relative', delay?, at?: path, offset? }` (e.g. 24 h before `booking.startsAt`).
  - Payload job `waitUntil`; delivery `status: queued` + `scheduledFor`.
  - `recheckConditions: true` re-evaluates at send time → `cancelled` when no longer valid.
  - Quiet hours per recipient timezone for `marketing` classification.

## Phase 4 — Admin-created triggers and Trigger Builder

Goal: administrators create, test, publish and version triggers in Payload Admin without code.

- **4.1 `notification-triggers` collection**
  - Fields: `name`, `slug`, `description`, `source` (event | collection + operation), `conditions` (JSON), `data` (sources), `recipients`, `deliveries`, `schedule`, `reliability`, `dedupe`, `overrides` (code slug, for managed triggers), `status`, `version`, `publishedAt`, `publishedBy`.
  - Server-side validation reuses the code-trigger validators (1.3, 2.6, 3.1).
- **4.2 Lifecycle and versioning**
  - `draft → validated → published → disabled → archived`.
  - Published versions immutable (`notification-trigger-versions` or Payload versions); editing a published trigger creates a draft; publishing increments `version`.
  - Deliveries record `triggerVersion`; disabling stops future matching and cancels queued deliveries only when `cancelQueuedOnDisable: true`.
  - Rollback = republish an earlier version.
- **4.3 Publish validation**
  - Event/collection availability, field references, data-source dependency graph, recipient resolution, template compatibility per channel, required template variables present in context, channel enabled, consent/classification configured.
  - Validation report shown in admin; publish blocked on errors.
- **4.4 Trigger Builder UI (multi-step)**
  - Steps: General → Source (application event | collection event) → Conditions → Data sources → Recipients → Deliveries (channel + template per recipient) → Schedule & reliability → Test & publish.
  - Pickers populated from registries (events, collection/field allowlists, resolvers, recipient resolvers, custom conditions, templates filtered by channel).
  - Visual condition builder (AND/OR groups, operator by field type, previous/current for collection events).
- **4.5 Code triggers in admin**
  - Read-only list of code triggers with their precedence policy.
  - "Customize" on `managed` triggers creates an override record limited to overridable fields; `enforced` shows locked state.
- **4.6 Test runner**
  - Sample event (registered `samplePayload` or pick a real document) → redacted context, matched triggers, recipients, planned deliveries, rendered output per channel.
  - Test delivery sends only to the current admin's destinations, marks deliveries `test: true`, never writes in-app notifications for other users or affects idempotency.
- **4.7 Admin permissions**
  - `manageTriggers`, `publishTriggers`, `testSend` access functions (default: admin-only via `access.isAdmin`).

## Phase 5 — Reliability, consent and providers

- **5.1 Idempotency hardening**
  - Event key: `eventId + triggerSlug + triggerVersion`; delivery key: `eventId + triggerSlug + recipientId + channel + templateVersion`.
  - Unique index on `notification-deliveries.idempotencyKey`; duplicate-key errors → `duplicate`.
  - Legacy fingerprint kept for legacy sends; include `eventId` when present.
- **5.2 Cross-source duplicate prevention**
  - Trigger `dedupe: { key: 'order.paid:{{ order.id }}', windowSeconds }` evaluated against context → `dedupeKey` on deliveries; same `dedupeKey + recipient + channel` within the window is skipped as `duplicate`.
  - Lets an explicit `order.paid` event and an `orders` update hook coexist intentionally.
  - Publish validation warns when two triggers share an event/collection and deliver the same channel to the same recipient without a dedupe key.
- **5.3 Failure taxonomy and retry policy**
  - Classify: `retryable | permanent | policy | duplicate | cancelled | unknown`.
  - Per-trigger/per-channel `reliability: { attempts, backoff, jitter }` within developer-set limits, mapped to Payload task retries.
  - Provider timeouts; ambiguous timeouts → `unknown`, never auto-resend.
- **5.4 Attempt log**
  - `notification-logs` becomes the per-attempt record (`delivery` relationship, `attempt`, `durationMs`, redacted `providerResponse`).
  - Rendered content not stored by default (`logs.storeRendered: false`).
- **5.5 Channel fallback**
  - `fallback: { channel, on: ['permanent', 'no-destination', 'policy'] }` creates a linked delivery; never on `unknown`.
- **5.6 Preferences and consent**
  - Optional `notification-preferences` collection: user × channel × category opt-in/out, consent timestamp and source.
  - Suppression list (bounces, STOP replies).
  - Order: suppression → mandatory transactional → category → channel → `canSend`; trigger `enabled` never overrides consent.
  - `preferences.mode: 'userFields' | 'collection'` keeps existing field mapping.
  - Unsubscribe token + endpoint for marketing email.
- **5.7 Provider interface v2**
  - `NotificationProvider<TChannel>`: `send`, `capabilities` (html, hsm, media, maxLength), `validateConfig`, optional `parseWebhook`.
  - Port Twilio / Meta / email / in-app; custom providers via `providers.custom`.
- **5.8 Webhooks and reconciliation**
  - Twilio status callbacks and Meta webhooks (signature verified) → `delivered/failed/read`.
  - `notification:reconcile` task for `unknown` / stale `sending`; retention task for logs/deliveries (`retention.days`).
- **5.9 Observability v2**
  - `ObservabilityEvent` gains `eventId`, `trigger`, `triggerSource`, `deliveryId`, `stage` (`matched|planned|skipped|sent|failed|delivered`), `durationMs`.
  - Keep `onDispatch`; add `onEvent` for all stages; structured redacted logs via `payload.logger`.

## Phase 6 — Templates v2 and multi-channel content

- **6.1 Locale support**
  - `locale` on templates; resolution `slug + channel + locale → fallbackLocale`; recipient locale from context.
- **6.2 Immutable published template versions**
  - Publish snapshots content; deliveries pin `templateVersion`; rollback republishes an older version.
- **6.3 Variable contract**
  - Derive available variables from event schema + trigger data sources + sample data.
  - Validate template references (unknown variable warning, missing required variable error) and expose a variables API for editors.
- **6.4 Channel-native content**
  - WhatsApp: HSM name, language, component parameter mapping, approval status sync (Meta API).
  - SMS: segment counter, GSM-7 vs UCS-2 detection, link-shortener hook.
  - In-app: title, body, action URL, icon, category.
  - Email: preheader, layout wrapper, link/button URL validation.
- **6.5 Starter template pack**
  - Ecommerce: `order.paid`, `order.shipped`, `order.delivered`, `order.cancelled`, `payment.failed`, `cart.abandoned`, `refund.processed`.
  - Auth: `auth.magic-link`, `auth.otp`, `auth.password-reset`, `user.welcome`, `user.email-verified`.
  - SaaS/business: `subscription.created`, `subscription.renewal-reminder`, `subscription.payment-failed`, `invoice.created`, `booking.confirmed`, `booking.reminder`, `ticket.updated`, `system.alert`.
  - Each with event definition, sample payload, channel variants; seeding idempotent and never overwrites admin-edited docs.

## Phase 7 — Visual Template Studio

Goal: non-technical admins design email (and preview every channel) visually, while the output
compiles to the existing template engine.

- **7.1 Editor technology spike**
  - Compare a custom React block editor (dnd-kit) vs. GrapesJS (MJML preset) vs. Lexical blocks; reject proprietary/paid embeds.
  - Criteria: bundle size in Payload admin, email-client-safe output, React 19 / Payload 4 compatibility, licence, extensibility.
  - Output: ADR in `docs/adr/` and chosen approach.
- **7.2 Block document model**
  - Versioned JSON schema stored in `email.design` (template field); `htmlBody`/`textBody` generated on save.
  - Blocks: section, columns, heading, text, image, button, divider, spacer, list, social links, footer, product/line-items (loop), conditional group.
  - Acceptance: model round-trips (save → load) without loss; schema migrations supported.
- **7.3 Email-safe compiler**
  - Compile blocks → table-based HTML with inlined CSS (or MJML → HTML) + auto-generated plain text.
  - Loop and conditional blocks emit `{{#each}}` / `{{#if}}`; variable chips emit `{{ path }}` (escaped), raw HTML block is a privileged permission.
  - Snapshot tests for Gmail/Outlook-safe markup.
- **7.4 Editor UI**
  - Drag-and-drop canvas, block palette, properties panel, undo/redo, keyboard support, copy/paste blocks.
  - Inline text editing with bold/italic/link and variable insertion.
- **7.5 Variables in the editor**
  - Variable picker and `{{` autocomplete fed by the variable contract (6.3) for the selected event/trigger.
  - Unknown/missing variables highlighted inline.
- **7.6 Brand theme and reusable sections**
  - Theme settings (logo, colors, fonts, button style, footer) as a global; templates inherit.
  - `notification-template-partials` for reusable headers/footers/sections, referenced by ID and versioned.
- **7.7 Media**
  - Image blocks use a configurable Payload upload collection (`templates.mediaCollection`); absolute URLs in output; alt text required.
- **7.8 Preview**
  - Desktop/mobile widths, dark-mode simulation, sample data selector (event sample, real document, trigger test data), rendered subject/preheader.
  - Accessibility checks (alt text, contrast, link text) and size warning (Gmail clipping > 102 KB).
- **7.9 Code mode interoperability**
  - Toggle visual ↔ code; converting visual → code is allowed (one-way, warns); code-only templates keep current editor with syntax highlighting + autocomplete.
- **7.10 Channel-native visual previews**
  - WhatsApp bubble preview with HSM params, SMS phone preview with segment counter, in-app card preview — all in the studio next to the email designer.
- **7.11 Versions in the studio**
  - Draft/publish controls, version history, visual and HTML diff, rollback (uses 6.2).
- **7.12 Test send from studio**
  - Uses the existing test-send endpoint, sends only to the current admin, marked as test.

## Phase 8 — Operations admin: deliveries, dashboard and permissions

- **8.1 Deliveries view**
  - Filter by status, channel, trigger, source, recipient, date; detail with attempts, provider response, redacted context.
  - Retry action for eligible failures (reuses idempotency key); cancel scheduled deliveries.
- **8.2 Overview dashboard**
  - Events received, trigger match rate, deliveries by status/channel over time, skip reasons, recent failures, provider latency/health, queue depth.
- **8.3 Providers & settings view**
  - Provider configuration status (secrets from env only, never shown), connection test, queue and retention settings (read-only where code-defined).
- **8.4 Access control**
  - Permissions: `manageTriggers`, `publishTriggers`, `manageTemplates`, `publishTemplates`, `testSend`, `viewDeliveries`, `retryDeliveries`, `managePreferences`; default admin-only via `access.isAdmin`.
  - Protect preview/test-send/inspector endpoints; tenant scoping for all admin collections.
- **8.5 Admin navigation**
  - Group: Overview, Triggers, Template Studio, Deliveries, Preferences, Providers & Settings.

## Phase 9 — Hardening, docs and release

- **9.1 Integration tests (closes #28)** — real Payload instance with SQLite/Postgres/Mongo; order.paid (event) and orders-update (collection) workflows, precedence policies, dedupe, retries, scheduling.
- **9.2 Compatibility suite** — 0.3.x configs (rules-only, registry-only, preference field mapping, legacy `queueNotificationSend`) run unchanged.
- **9.3 Security review** — endpoint access, redaction, webhook signatures, raw HTML policy, no arbitrary code paths from admin input, tenant boundaries.
- **9.4 Migration guide** — rules → triggers, logs → deliveries + attempts, new collections, template designs, data migration script if needed.
- **9.5 Docs** — events, code triggers, admin triggers + precedence, data sources, recipients, deliveries, scheduling, dedupe, visual studio, webhooks; deployment guide (closes #27); booking and ecommerce end-to-end examples.
- **9.6 Release** — `0.x-beta` per release slice below, validated in electrofit before `1.0.0`.

---

## Release slicing

| Release | Includes | User-visible value |
| --- | --- | --- |
| 0.4.0 | Phase 1 + 2 | Event registry, multi-collection data in templates, multiple recipients, delivery records, precedence policy |
| 0.5.0 | Phase 3 + 5.1–5.4 | Collection-hook triggers, change detection, scheduling, safe idempotency and dedupe |
| 0.6.0 | Phase 4 | Admin-created triggers, Trigger Builder, test runner |
| 0.7.0 | 5.5–5.9 + Phase 6 | Preferences, fallback, webhooks, locales, pinned versions, starter pack |
| 0.8.0 | Phase 7 | Visual Template Studio |
| 0.9.0 | Phase 8 | Deliveries dashboard, permissions |
| 1.0.0 | Phase 9 | Stable API, migration guide, integration-tested |

## Dependencies

```
Phase 1 ──▶ Phase 2 ──┬──▶ Phase 3 ──▶ Phase 4 (admin triggers need 3.1 conditions, 3.2 collection events)
                      ├──▶ Phase 5 (5.1/5.2 need 2.7 deliveries)
                      └──▶ Phase 6 ──▶ Phase 7 (visual editor needs 6.2 versions, 6.3 variables)
Phases 4, 5, 7 ──▶ Phase 8 ──▶ Phase 9
```

## Coverage checklist

| Source requirement | Item(s) |
| --- | --- |
| Event sources: domain, collection, custom | 1.2, 3.2 |
| Event registry with label, schema, classification, sample | 1.2 |
| Trigger lifecycle & immutable versions | 4.2 |
| Code-defined triggers, `defineTrigger` compatibility | 2.1, 2.2 |
| Admin-created triggers + Trigger Builder steps | 4.1, 4.4 |
| Code vs admin precedence (independent / managed / enforced) | 2.3, 4.5 |
| Data sources: event, document, collection, relationship, resolver | 1.3–1.5, 3.2 |
| Field allowlists, sensitive data, redaction | 1.3, 1.6 |
| Recipients (all types, canonical, dedupe, locale/timezone) | 2.5 |
| Multiple deliveries per trigger | 2.6 |
| Conditions + change detection | 3.1, 3.2 |
| Recursion prevention, deterministic hooks, tenancy | 3.2, 3.3, 8.4 |
| Scheduling, quiet hours, cancellation | 3.5 |
| Publish validation, test & preview, safe test sends | 4.3, 4.6, 7.12 |
| Cross-source duplicate prevention | 5.2 |
| Idempotency, retries, failure taxonomy, fallback | 5.1, 5.3, 5.5 |
| Trigger / event / delivery / attempt separation | 2.7, 3.4, 5.4 |
| Consent, preferences, suppression, unsubscribe | 5.6 |
| Provider interface, webhooks, reconciliation, retention | 5.7, 5.8 |
| Observability | 5.9, 8.2 |
| Template authoring modes: visual, code, channel-native | 7.x, 6.4 |
| Template record (locale, version, variables, provider IDs) | 6.1–6.4 |
| Starter template library | 6.5 |
| Admin navigation | 8.5 |
| Testing & release criteria, compatibility | 9.1–9.3 |
| Docs, migration | 9.4, 9.5 |

## Open questions

1. Payload `versions/drafts` vs. custom version collections for triggers and templates — check D1 support for electrofit.
2. Visual editor technology — decided by spike 7.1.
3. Campaigns (#30 phase 2) before 1.0, or 1.x on top of deliveries?
4. Is a `tenant` field on triggers/templates/deliveries required for electrofit?

## Tracking

| Phase | Issue |
| --- | --- |
| Phase 1 — Contracts, event registry and data context builder | [#71](https://github.com/w3panel/payload-notifications/issues/71) |
| Phase 2 — Unified trigger engine, recipients and deliveries | [#72](https://github.com/w3panel/payload-notifications/issues/72) |
| Phase 3 — Conditions, collection events and scheduling | [#73](https://github.com/w3panel/payload-notifications/issues/73) |
| Phase 4 — Admin-created triggers and Trigger Builder | [#74](https://github.com/w3panel/payload-notifications/issues/74) |
| Phase 5 — Reliability, consent and providers | [#75](https://github.com/w3panel/payload-notifications/issues/75) |
| Phase 6 — Templates v2 and multi-channel content | [#76](https://github.com/w3panel/payload-notifications/issues/76) |
| Phase 7 — Visual Template Studio | [#77](https://github.com/w3panel/payload-notifications/issues/77) |
| Phase 8 — Operations admin: deliveries, dashboard and permissions | [#78](https://github.com/w3panel/payload-notifications/issues/78) |
| Phase 9 — Hardening, docs and release | [#79](https://github.com/w3panel/payload-notifications/issues/79) |
