# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
