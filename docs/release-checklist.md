# Release checklist

## Channels

| Line | Branch | Tag | npm dist-tag | For |
|---|---|---|---|---|
| 0.4.x betas | `main` | `v0.4.0-beta.N` | `next` | Payload 4 apps (electrofit) |
| 0.3.x stable | `release/0.3.x` | `v0.3.N` | `latest` | Payload 3 apps (HappenCare) |

Stable tags from `main` would also publish to `latest`; until 0.4 / 1.0 is promoted, release stable versions only from `release/0.3.x` (its publish workflow refuses prerelease tags). Backport fixes that affect Payload 3 apps to `release/0.3.x`.

Pushing a `v*` tag runs `.github/workflows/publish.yml`. It tests, builds and publishes with provenance; prerelease tags go to `next`.

## Before tagging

- [ ] All milestone PRs are merged and CI on `main` is green:
  - unit and SQLite integration tests on Payload 3.92 and 4 beta
  - Postgres and MongoDB integration tests
  - build, and `check:package` (every entry point exists)
- [ ] `package.json` `version` matches the tag, and `CHANGELOG.md` has a section for it with the date.
- [ ] Breaking or behaviour changes are listed in the changelog, and in [migration.md](./migration.md) when needed.
- [ ] Packaging looks right: `bun run build && bun run check:package && npm pack --dry-run` lists only `dist`, `docs`, `README.md`, `COMPATIBILITY.md`, `CHANGELOG.md` and `LICENSE`.
- [ ] Docs links resolve (README table and [docs/README.md](./README.md)).

## Validate a beta in a consumer app (before 1.0.0)

- [ ] Install `@wtree/payload-notifications@next` in electrofit (Payload 4, Cloudflare D1) and in a Payload 3 app.
- [ ] Generate and apply database migrations, and regenerate the admin import map.
- [ ] Emit a real event and check deliveries, attempts and the overview.
- [ ] Use **Test connection** for each provider and send a template test to yourself.
- [ ] Run the job queue the way production does (cron, worker or Workers cron trigger).

## Publish

1. Bump `version` in `package.json` and date the changelog section.
2. Merge to `main`.
3. Tag and push: `git tag v0.4.0-beta.1 && git push origin v0.4.0-beta.1`.
4. Check the publish workflow. On npm, `npm view @wtree/payload-notifications dist-tags` should show the version on `next` (prerelease) or `latest`.
5. Create a GitHub release from the changelog section.

## After publishing

- [ ] Smoke-test `bun add @wtree/payload-notifications@<tag>` in a fresh Payload app.
- [ ] Track first-release issues; fix forward with a new beta.
