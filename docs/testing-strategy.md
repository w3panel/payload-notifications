# Testing strategy

## Scope
This plugin should maintain automated coverage across:
- collections
- config normalization and validation
- event processing and send jobs
- channel success, skip, retry, and failure paths
- template resolution and rendering
- policy and preference evaluation
- reliability helpers and observability hooks

## Suites

- **Unit tests** (`tests/*.test.ts`) use an in-memory Payload stand-in (`tests/helpers/memoryPayload.ts`). They are fast and cover branches and edge cases.
- **Integration tests** (`tests/integration`) boot a real Payload instance with the plugin, on SQLite in memory by default. They run complete workflows: events, collection changes, retries, scheduling, admin precedence, the 0.3.x compatibility config, and the booking example. To run them on another database:
  - **Postgres:** set `PAYLOAD_TEST_POSTGRES_URL` and install `@payloadcms/db-postgres`.
  - **MongoDB:** set `PAYLOAD_TEST_MONGODB_URL` and install `@payloadcms/db-mongodb`.

  Both use the same version as `payload`.
- **Compatibility:** CI runs typecheck and every test on Payload 3.92 and Payload 4 beta. It also runs the integration suite on Postgres and MongoDB.
- **Security regressions** (`tests/security.test.ts`) include a check that every non-public endpoint refuses anonymous calls.

## Principles
- Prefer focused unit tests with explicit mocks.
- Cover success, failure, and edge cases.
- Keep provider integrations abstracted behind adapters.
- Add regression tests for every production bug fix.

## CI expectations
A healthy CI run should include:
- dependency install
- format checks
- lint checks
- `bun test` (unit and SQLite integration) on Payload 3 and 4
- the integration suite on Postgres and MongoDB
- `bun run build`
- package build validation before publish

## Contributor guidance
When adding features:
1. Add or update tests in the nearest module test file.
2. Cover at least one unhappy path.
3. Prefer deterministic inputs and explicit assertions.
4. Document any intentionally deferred coverage.
