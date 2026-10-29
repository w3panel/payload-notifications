# Security

This page describes the plugin's security model and the review done before 1.0 (Phase 9.3). Report vulnerabilities privately to the maintainers, not in a public issue.

## Model

- **Admin endpoints** need a signed-in user plus one of the `access.*` checks (see [operations-admin.md](./operations-admin.md#permissions)). Each check defaults to `access.isAdmin`, which defaults to *any logged-in user*. Production apps should pass role checks.
- **Public endpoints** are limited to these two:
  - **One-click unsubscribe** (`/api/payload-notifications/unsubscribe`): HMAC-signed tokens checked in constant time, and only when `preferences.unsubscribe.secret` is set.
  - **Provider webhooks** (`/api/payload-notifications/webhooks/*`):
    - Twilio requests carry an `X-Twilio-Signature` HMAC.
    - Meta requests carry an `X-Hub-Signature-256` HMAC (app secret); its subscription check uses the verify token.
    - Custom providers verify in their own `parseWebhook`.
    - Signatures are compared in constant time. A provider without configured secrets returns 404.
- **Server-side code** (jobs, hooks, the Local API) passes `overrideAccess` explicitly on every call. That matters on Payload 4, where the Local API no longer bypasses access by default.

## Data exposure

- **Hidden fields:** delivery context, raw destinations, retry policy, template overrides and the stored event in the inbox are server-only fields. The API and admin never return them.
- **Redaction:** previews, the trigger test runner, the delivery inspector and attempt-log provider responses go through `data.redact` and the sensitive-field denylist (passwords, tokens, secrets, keys, …). Data sources cannot load sensitive fields. `logs.storeRendered` is off by default.
- **Provider settings:** the settings view and API report which credentials are *set* and never their values. Connection tests return only status and safe metadata.
- **Destinations:** masked (`a***@example.com`, `+91******3210`) in deliveries, logs and lifecycle events.

## Admin input never becomes code

- **Conditions** are JSON evaluated by a fixed operator set. Custom conditions, recipient resolvers and queries, data resolvers and computed values are referenced **by name** and must be registered in code.
- **The template engine** has no expressions or helpers beyond the built-in formatters. It rejects `constructor`, `__proto__`, `prototype`, `new`, `import(`, `require(`, `eval(` and `Function(` in tags.
- **Paths** (data-source fields, lookups, captured fields, conditions) never follow `__proto__`, `constructor` or `prototype`. Data sources with such fields are rejected.
- **Collection data sources** can only read collections and fields listed in `data.collections`, and the previews and test runner read them with the caller's access.

## HTML

- **Escaping:** `{{ value }}` is HTML-escaped; `{{{ value }}}` is not. Template validation warns about every triple-brace expression, so use them only for trusted HTML.
- **Visual designer text:** text produces only escaped `{{ path }}` expressions. Triple braces and block tags typed into text stay literal.
- **Raw HTML blocks** need `access.rawHtml`, which defaults to **nobody**. Saving a design that adds or changes one is refused without it; unchanged raw blocks from a privileged author may be kept.
- **Code mode** gives anyone with `manageTemplates` full control of the HTML. Grant `manageTemplates` to people you would trust with your email HTML.
- **Links:** email links with schemes other than `http`, `https`, `mailto` and `tel` are rejected on validation and removed when sending.
- **Admin previews** render in sandboxed iframes (`sandbox=""`, no scripts).

## Tenants

With `tenancy`, deliveries, attempt logs, events and the overview are filtered to the user's tenant, and delivery inspect, retry and cancel load records with the caller's access. Previews of real documents and data sources also use the caller's access, so **your collections' access rules must enforce tenancy**. Triggers, templates, partials and the theme are shared across tenants.

## Test sends

Template and trigger test sends go only to the signed-in user, are marked `[Test]`, and need `access.testSend`. Provider connection tests never send messages.

## Review (Phase 9.3)

**Checked:**
- Every endpoint's access check. A regression test calls each non-public endpoint without a user and expects 401/403.
- Redaction paths, webhook signature verification, unsubscribe tokens and the raw HTML policy.
- Code paths reachable from admin input, and tenant filters.

**Fixed:**
- **Prototype pollution:** an admin-defined data-source field such as `__proto__.x`, together with an event payload containing a `__proto__` key, could write to `Object.prototype`. Path helpers now refuse prototype keys, and such fields are rejected on validation.
- **Auth before input:** the trigger lifecycle endpoint read and validated the body before checking for a user. It now refuses anonymous calls first.
- **Missing permission checks:** the preview, compile, variables, event and data-source endpoints checked only for a signed-in user. They now require `manageTemplates` or `manageTriggers` (Phase 8).
- **Template test-send recipient:** it accepted any `userId`. It now sends only to the caller (Phase 7).
