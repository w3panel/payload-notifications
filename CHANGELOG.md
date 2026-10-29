# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0-beta.2] - 2026-10-29

### Docs
- Migration guide: on SQLite / D1, the generated migration's `notification_templates` rebuild copies columns that don't exist yet; how to check and fix it

## [0.4.0-beta.1] - 2026-10-29

First beta of the notification automation release (roadmap Phases 1–9). 0.3.x configurations keep working; see [docs/migration.md](docs/migration.md). Published to npm `next` for validation before 1.0.0.

### Fixed
- Found by testing in a Payload 3 / Next.js / D1 app: the first publish of a draft template is now version 1 (new templates start at version 0); the delivery inspector masks the recipient's email and phone; the generated HTML / text bodies are hidden while the visual designer is used; the designer layout follows the form width

### Added — Events, triggers and deliveries (Phases 1–4)
- Event registry with Standard Schema validation, sample payloads and `eventsStrict`
- Data context builder: allowlisted collection data sources, resolvers, computed values and a sensitive-field denylist
- Unified trigger engine for code triggers and legacy rules, with recipients (event user, relationship, static, role, resolver, query) and one `notification-deliveries` record per recipient × channel
- JSON conditions (`all` / `any` / `not`, change operators such as `changedTo`) and custom conditions
- Collection events from `afterChange` / `afterDelete`, with a loop guard (`maxEventDepth`) and tenancy
- An optional events inbox with replay
- Scheduling (`delay`, `at`, `relative`, `recheckConditions`, `skipIfPast`) and quiet hours
- Admin-created triggers with immutable published versions and precedence policies (independent / managed / enforced), a Trigger Builder and a test runner

### Added — Reliability, consent and providers (Phase 5)
- Dedupe keys, a failure taxonomy (retryable / permanent / unknown), retries with backoff and fallback channels
- Provider interface v2 (`providers.custom`) and attempt logs
- Twilio and Meta status webhooks with signature checks
- Reconcile and retention maintenance tasks, and lifecycle observability (`observability.onEvent`)
- Collection-mode preferences, suppressions and signed one-click unsubscribe

### Added — Templates v2 (Phase 6)
- Locale variants, immutable published versions with publish / rollback, and deliveries pinned to a template version
- A variable contract with checks
- Channel-native content: email preheader and layout, SMS segments and link shortening, WhatsApp approved templates, in-app action URL / icon / priority
- A starter template pack and edit-safe seeding

### Added — Hardening (Phase 9)
- Integration test suite on a real Payload instance (SQLite; Postgres and MongoDB in CI), including a 0.3.x compatibility config and a tested booking example (`examples/booking`)
- Docs: deployment guide, migration guide, security model and review, examples, and a docs index

### Fixed (Phase 9)
- SQL databases (Postgres, SQLite, D1): relationship fields written from string IDs (attempt log user and delivery, in-app recipient, fallback link) were rejected; they now use the target collection's ID type
- SQL databases: unique violations (a repeated event ID with the inbox, duplicate deliveries) were not recognised and failed instead of being skipped
- Data paths never follow `__proto__` / `constructor` / `prototype`, and such data-source fields are rejected (prototype pollution)
- The trigger lifecycle endpoint refuses anonymous requests before reading the body; template validation warns about unescaped `{{{ }}}` output
- Package entry points: `main` and the `require` conditions pointed at CommonJS files that were never built, and `styles.css` was exported but not copied into `dist`. The package is ESM-only, as Payload is; CI now checks every entry point after the build

### Added — Operations admin (Phase 8)
- Deliveries inspector: attempts, provider responses, fallbacks and redacted context; retry (same record and idempotency key; `unknown` needs confirmation) and cancel (`planned` / `queued`), via `GET /:id/inspect`, `POST /:id/retry` and `POST /:id/cancel`
- Notifications overview on the Payload dashboard (`GET /api/payload-notifications/stats`): events, match rate, deliveries over time, skip reasons, recent failures, provider latency and failure rate, queue depth
- Providers & settings tab (`GET /api/payload-notifications/settings`, `POST …/providers/:channel/test`): provider status without secrets, connection tests, read-only settings; optional `testConnection()` on custom providers
- Permissions `manageTemplates`, `viewDeliveries`, `retryDeliveries`, `managePreferences`; tenant scoping of deliveries, attempt logs, events and stats (deliveries gain a `tenant` field)
- `admin.dashboard`, `admin.group`, `admin.navLinks`; collections grouped under Notifications in nav order

### Changed
- Templates and partials need `manageTemplates` to change (default `isAdmin`); deliveries, logs and events need `viewDeliveries`; preferences admin uses `managePreferences` instead of `manageTriggers`
- The preview, compile-design, variables, events and data-source endpoints check permissions, not only sign-in

### Added — Visual Template Studio (Phase 7)
- Visual email designer in the template studio: a versioned block document in `email.design` with sections, columns, headings, text, images, buttons, dividers, spacers, lists, social links, footers, loops, conditions, saved sections and raw HTML. It compiles on save to table-based, inline-styled, Outlook-safe HTML plus plain text (ADR: `docs/adr/0001-visual-email-editor.md`)
- Drag and drop, keyboard editing, undo/redo, copy/paste; a formatting toolbar; `{{` variable autocomplete with unknown variables highlighted
- `notification-theme` global (brand theme) and the `notification-template-partials` collection (versioned reusable sections)
- `templates.mediaCollection` / `templates.mediaBaseUrl` for images and the theme logo; images need alt text and absolute URLs
- Preview with sample data (event sample, real document, trigger data or JSON), desktop and mobile widths, dark-mode simulation, accessibility and size checks, and channel-native SMS / WhatsApp / in-app previews
- Code mode: one-way visual → HTML conversion (`POST …/compile-design`); `{{` autocomplete in Payload's code editors
- Versions panel: publish, history, field and HTML diff, side-by-side previews, rollback
- `access.rawHtml` (default: nobody)

### Changed
- Template test-send goes only to the signed-in admin (another `userId` is rejected). It is marked `[Test]`, uses the preview's sample data and unsaved visual design, and applies channel finishing
- `templates.emailLayout` no longer wraps compiled visual designs, which are full documents
- The variables endpoint also returns `roots`
- New collection (`notification-template-partials`) and global (`notification-theme`): SQL hosts need a migration

### Added
- Payload 3 support alongside Payload 4: peer range is now `^3.92.0 || >=4.0.0-beta.4 <5`. `authorship: false` is set only on Payload 4, and the `notification:send` concurrency key only where the host supports it (always on Payload 4; on Payload 3 when `jobs.enableConcurrencyControl` is on)
- CI matrix runs typecheck and tests on Payload 3.92 and Payload 4 beta
- Release channels: prerelease tags publish to npm `next`, other tags to `latest`

## [0.3.2] - 2026-10-29

### Fixed
- Admin template studio crashed the `notification-templates` edit view: the bundled `admin` entry lost its `'use client'` directive, so Payload rendered `TemplateStudioField` as a server component
- Template studio read form data through `useFormFields((fields, dispatch) => dispatch.getData())`, which matches no Payload release (the selector receives a single `[fields, dispatch]` tuple, and `dispatch` has no `getData`); it now uses `useForm().getData()`, read when Preview / Send test runs

## [0.3.1] - 2026-10-29

### Changed
- Meta WhatsApp Cloud API provider now targets Graph API `v25.0` (was `v21.0`)

### Fixed
- `repository`, `homepage`, and `bugs` URLs point at `w3panel/payload-notifications` so npm provenance verification passes

## [0.3.0] - 2026-10-27

### Added
- Admin **template studio** (preview + test-send + engine help) on `notification-templates`
- Collection endpoints `POST …/preview` and `POST …/test-send`
- Package export `@wtree/payload-notifications/admin`
- `seedTemplatesFromRegistry` + `templates.seedOnInit`
- Email `htmlBody` fidelity in resolve/render (real HTML when set)
- Usage docs suite under `docs/` (getting-started through end-to-end + options-reference)
- Deep Payload `TaskConfig` for notification tasks: `label`, `interfaceName`, `inputSchema`, `outputSchema`, exponential `retries` on send, fingerprint `concurrency`, and `onFail` log/observability hooks
- `jobs.queue` plugin option (default `notifications`)
- Unified `writeNotificationLog` helper aligned to schema fields (`fingerprint`, `failureClassification`, `providerResponse.messageID`, optional `meta.jobId`)
- `renderDefinition` / `mergeTemplateDefinition` send-path helpers
- Indexed `fingerprint` and `failureClassification` fields on `notification-logs`

### Changed
- **BREAKING (jobs):** Retriable send failures now **throw** so Payload retries the same job. Custom `attempt` re-queue loops were removed.
- **BREAKING (jobs):** Notification jobs default to the named queue `notifications` (was implicit `default`). Override with `jobs.queue`.
- Email / SMS / WhatsApp / in-app sends resolve templates then render via the Handlebars-subset engine before delivery (SMS/WhatsApp no longer send raw template keys).
- Email subjects come from template definitions (token-replaced) instead of a hardcoded `Notification: ${event}` when a subject exists.
- `processEvent` now forwards `classification` and per-channel `templateOverrides` into `notification:send` inputs.
- Host apps should not force `state: 'succeeded'` on notification send handlers when a failure should retry.

### Fixed
- Idempotency fingerprint queries now match a real collection field
- Provider message IDs written as `providerResponse.messageID` (schema field name)
- Stale README section that claimed SMS/WhatsApp were mock providers
- `COMPATIBILITY.md` updated for Payload 4 peers and Node engines

## [0.2.0] - 2026-10-26

### Changed
- **BREAKING:** Default channels changed from `['email', 'whatsapp', 'sms', 'inapp']` to `['email', 'inapp']`. SMS and WhatsApp must now be explicitly enabled with provider credentials.
- **BREAKING:** Configuration validation now runs at plugin creation time (fail-fast). Invalid configs that previously failed silently at runtime now throw immediately with clear `payload-notifications:` prefixed error messages.
- **BREAKING:** In-app notifications now persist resolved template `title` and `message` with token replacement instead of generic placeholder text.
- Task handlers are now wired as live handlers via `onInit` and work out of the box without host-app overrides. The deferred handler pattern has been removed.
- All validation error messages now use a consistent `payload-notifications:` prefix.
- Peer dependency updated to `payload >=4.0.0-beta.4 <5`.
- WhatsApp and SMS provider factories now create real HTTP-based provider adapters instead of returning mock results.

### Added
- Phase 1 template engine (Handlebars-subset) with variables, conditionals, loops, formatters, and HTML auto-escaping
- `notification-templates` collection with per-channel content, variable schema, status/version, and auto-increment on publish
- Async DB-first template resolution with code registry fallback (`resolveTemplate` / `resolveTemplateSync`)
- Enhanced trigger system: `defineTrigger()`, rule `enabled` flag, and `templateOverrides`
- Notification log fields: `templateSlug`, `templateVersion`, `renderDurationMs`
- Live task handler registration through plugin `onInit` hook — jobs execute without host-app wiring
- Real Meta WhatsApp Cloud API provider (`providers.whatsapp.provider: 'meta'`)
- Real Twilio SMS provider (`providers.sms.provider: 'twilio'`)
- Real Twilio WhatsApp provider (`providers.whatsapp.provider: 'twilio'`)
- Config validation for Meta WhatsApp and Twilio credentials at plugin initialization
- Exported `createMetaWhatsAppProvider`, `createTwilioSMSProvider`, `createTwilioWhatsAppProvider`
- Validation for unknown channel names and empty channels arrays
- Documentation for jobs processing, serverless constraints, providers, and migration from 0.1.x

### Fixed
- Task handlers no longer return a `state: 'failed'` deferred error — they execute the real job logic after initialization

## [0.1.1] - 2026-03-09

### Added
- Initial project structure
- Core plugin configuration

## [0.0.1] - 2026-03-09

### Added
- Initial release
