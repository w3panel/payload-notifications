# Compatibility

## Payload CMS Versions

| Plugin Version | Payload Version | Status |
|----------------|-----------------|--------|
| 0.2.x+         | `>=4.0.0-beta.4 <5` | Supported |
| 0.1.x          | ^3.79.0             | Legacy (unmaintained) |

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
