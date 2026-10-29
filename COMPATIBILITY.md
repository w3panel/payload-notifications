# Compatibility

## Payload CMS Versions

| Plugin Version | Payload Version | npm dist-tag | Status |
|----------------|-----------------|--------------|--------|
| next (unreleased) | `^3.92.0` and `>=4.0.0-beta.4 <5` | `latest` (stable) / `next` (prereleases) | Supported |
| 0.2.x – 0.3.x  | `>=4.0.0-beta.4 <5` | `latest` | Supported |
| 0.1.x          | ^3.79.0             | — | Legacy (unmaintained) |

One build serves both majors. CI runs typecheck and the full test suite against Payload 3.92 and Payload 4 beta.

- Install the stable channel with `bun add @wtree/payload-notifications`; prereleases (tested first against Payload 4 betas) with `bun add @wtree/payload-notifications@next`.
- Release tags without a prerelease suffix (`v0.4.0`) publish to `latest`; prerelease tags (`v0.4.0-next.1`, `v0.4.0-beta.2`) publish to `next`.

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
