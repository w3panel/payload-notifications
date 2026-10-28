# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
