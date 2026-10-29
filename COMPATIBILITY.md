# Compatibility

## Payload CMS Versions

| Plugin Version | Payload Version | npm dist-tag | Status |
|----------------|-----------------|--------------|--------|
| 0.4.x betas | `>=4.0.0-beta.4 <5` (also runs on `^3.92.0`) | `next` | Beta: Payload 4 apps (e.g. electrofit) |
| 0.3.3+ (0.3.x, branch `release/0.3.x`) | `^3.92.0` | `latest` | Stable: Payload 3 apps (e.g. HappenCare) |
| 0.2.0 – 0.3.2 | `>=4.0.0-beta.4 <5` | — | Superseded |
| 0.1.x | ^3.79.0 | — | Legacy (unmaintained) |

Two release lines:

- **Payload 3: `bun add @wtree/payload-notifications`** installs the stable 0.3.x line from `latest`. Fixes are made on the `release/0.3.x` branch, which publishes stable tags (`v0.3.4`, …) to `latest` only.
- **Payload 4: `bun add @wtree/payload-notifications@next`** installs the 0.4.x betas from `next`. They are built from `main`; prerelease tags (`v0.4.0-beta.N`) publish to `next`.

The 0.4.x code also runs on Payload 3.92 (CI tests both majors), so a Payload 3 app can opt into the beta features. Moving `latest` to 0.4.x / 1.0 is a separate decision once the betas are validated.

### Payload 3 vs 4 differences handled by the plugin

| Area | Payload 3 | Payload 4 |
|------|-----------|-----------|
| Collection `authorship` option | Not available; not set | Set to `false` on plugin collections |
| `notification:send` job concurrency key (one job per delivery at a time) | Only when the host sets `jobs.enableConcurrencyControl: true` (Payload 3 needs that flag, plus a migration, before tasks can use `concurrency`) | Always on |

Without concurrency control on Payload 3, deliveries that are already final are not sent again, but two workers can race on the same delivery. Enable `jobs.enableConcurrencyControl` on hosts that run several workers.

## Node.js Versions

- **Minimum**: Node.js 24.22.1 (see `package.json` `engines`)
- Package manager for development/tests: **Bun**

## Browser Support

- Modern evergreen browsers (Chrome, Firefox, Safari, Edge)
- ES2020+ JavaScript support required
- Client export (`@wtree/payload-notifications/client`) is a stub for future in-app UI hooks

## Database Support

Supports all databases compatible with Payload CMS:
- MongoDB
- PostgreSQL
- SQLite

## Jobs runner

Notification tasks default to the Payload jobs queue named `notifications`. Host apps must either:

1. Configure `jobs.autoRun` for that queue on a long-lived process, or
2. Invoke Payload's jobs run endpoint / worker for `queue=notifications` on a schedule (typical on Vercel).

## Notes

- Ensure Payload CMS version alignment within the peer range above
- TypeScript 5.x required for development
