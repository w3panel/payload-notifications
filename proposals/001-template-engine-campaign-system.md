# RFC 001: Unified Template Engine + Campaign System

| Field       | Value                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| **Status**  | Proposed                                                               |
| **Authors** | —                                                                      |
| **Issue**   | [#30](https://github.com/technewwings/payload-notifications/issues/30) |
| **Created** | 2026-03-26                                                             |

---

## 1 Problem Statement

The current notification system in `@wtree/payload-notifications` uses a **code-defined template registry** with simple `{{ token }}` interpolation. This architecture creates several gaps:

1. **Non-technical teams cannot author or iterate on content** without a developer modifying source code and deploying.
2. **Multi-channel consistency is manual** — each channel's content is a separate string with no structural relationship to the others.
3. **No campaign concept exists** — there is no way to schedule a batch notification to a user segment, track engagement, or run A/B variants.
4. **Rich channel features are unused** — WhatsApp HSM templates, HTML email layouts, and SMS segment-count awareness have no first-class support.

This RFC proposes a phased upgrade that adds an admin-managed template engine and a full campaign system while preserving backward compatibility with the existing API.

---

## 2 Goals & Non-Goals

### Goals

- Admin-managed templates stored as a Payload collection.
- A lightweight rendering engine with conditionals, loops, and formatters.
- Channel-specific output from a single template definition.
- Scheduled and immediate campaign sends with audience targeting.
- A/B testing with deterministic variant assignment and auto-winner selection.
- Delivery, open, and click analytics per campaign.
- Full backward compatibility with existing code-defined templates.

### Non-Goals (for this RFC)

- Push notification channel (deferred to Phase 3).
- Block-based WYSIWYG email editor (Phase 3).
- Localization / i18n (Phase 3).
- Real-time collaborative editing of templates.

---

## 3 Architecture

### 3.1 High-Level View

```
┌─────────────────────────────────────────────────────────────┐
│                      Payload Admin UI                        │
│   ┌───────────────┐  ┌────────────────┐  ┌───────────────┐  │
│   │  Template      │  │  Campaign       │  │  Analytics    │  │
│   │  Editor + Test │  │  Manager        │  │  Dashboard    │  │
│   └───────┬───────┘  └───────┬────────┘  └───────────────┘  │
└───────────┼──────────────────┼───────────────────────────────┘
            │                  │
      ┌─────▼──────┐    ┌─────▼───────┐
      │ notification│    │  campaigns  │
      │ -templates  │    │  collection │
      │ collection  │    └─────┬──────┘
      └─────┬──────┘          │
            │           ┌─────▼──────────────┐
      ┌─────▼───────────┤ Campaign Processor │
      │                 │ (audience → batch)  │
      │                 └─────┬──────────────┘
      │                       │
┌─────▼───────────────────────▼──────┐
│         Rendering Engine            │
│  {{#if}} · {{#each}} · {{ fmt }}   │
│  (zero native deps, tree-shakeable) │
└─────┬──────────────────────────────┘
      │
┌─────▼──────────────────────────────┐
│     Channel Adapters (upgraded)     │
│  email │ sms │ whatsapp │ inapp    │
│  (HTML   (char/  (HSM     (rich    │
│   wrap)  segs)   params)  blocks)  │
└─────┬──────────────────────────────┘
      │
┌─────▼──────────────────────────────┐
│  Existing Delivery Pipeline         │
│  processEvent → sendNotification    │
│  (fingerprint, retry, observability)│
└────────────────────────────────────┘
```

### 3.2 Template Resolution Flow

```
resolveTemplate(slug, channel, context)
  │
  ├─ 1. Query `notification-templates` collection
  │     WHERE slug = :slug AND status = 'active'
  │     ORDER BY version DESC LIMIT 1
  │
  ├─ 2. If found → extract channel-specific content block
  │     → pass to rendering engine with context
  │     → return rendered output
  │
  └─ 3. If not found → fall back to code registry (existing behavior)
        → use current {{ token }} interpolation
        → return rendered output
```

This two-tier resolution ensures that existing integrations continue working without changes while new templates authored in the admin panel take precedence.

### 3.3 Campaign Processing Flow

```
Campaign (status: 'scheduled', sendAt: T)
  │
  ├─ Cron / scheduler triggers `notification:process-campaign`
  │
  ├─ Resolve audience → paginated user query (page size: 500)
  │
  ├─ If A/B test:
  │   ├─ Hash userId → assign variant deterministically
  │   └─ Select template per variant
  │
  ├─ For each batch:
  │   ├─ Queue `notification:send` tasks (existing pipeline)
  │   └─ Update campaign stats (sent count)
  │
  ├─ On completion → update status to 'sent'
  │
  └─ If A/B: after evaluation window → pick winner → send to holdout
```

---

## 4 Detailed Design

### 4.1 `notification-templates` Collection

**Slug:** `notification-templates`

```typescript
// Proposed field schema (Payload collection config)
{
  slug: 'notification-templates',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'category', 'status', 'channels'] },
  fields: [
    { name: 'name',        type: 'text',   required: true },
    { name: 'slug',        type: 'text',   required: true, unique: true, index: true },
    { name: 'description', type: 'textarea' },
    { name: 'category',    type: 'select', options: ['transactional', 'marketing', 'system'] },
    { name: 'status',      type: 'select', options: ['draft', 'active', 'archived'], defaultValue: 'draft' },
    { name: 'version',     type: 'number', defaultValue: 1, admin: { readOnly: true } },
    { name: 'channels',    type: 'select', hasMany: true,
      options: ['email', 'sms', 'whatsapp', 'inapp', 'push'] },

    // Channel-specific content blocks
    { name: 'email', type: 'group', fields: [
      { name: 'subject',  type: 'text' },
      { name: 'htmlBody', type: 'code', admin: { language: 'html' } },
      { name: 'textBody', type: 'textarea' },
      { name: 'layout',   type: 'text', admin: { description: 'Layout slug (optional)' } },
    ]},
    { name: 'sms', type: 'group', fields: [
      { name: 'body', type: 'textarea' },
    ]},
    { name: 'whatsapp', type: 'group', fields: [
      { name: 'body',          type: 'textarea' },
      { name: 'hsmTemplateId', type: 'text',
        admin: { description: 'Meta-approved HSM template ID (optional)' } },
      { name: 'hsmParams',     type: 'json',
        admin: { description: 'Array of param mappings for HSM template' } },
    ]},
    { name: 'inapp', type: 'group', fields: [
      { name: 'title', type: 'text' },
      { name: 'body',  type: 'textarea' },
    ]},

    // Variable schema (for editor auto-complete and validation)
    { name: 'variables', type: 'array', fields: [
      { name: 'name',     type: 'text',     required: true },
      { name: 'type',     type: 'select',   options: ['string', 'number', 'date', 'boolean', 'object'] },
      { name: 'required', type: 'checkbox',  defaultValue: false },
      { name: 'default',  type: 'text' },
    ]},
  ],
  hooks: {
    beforeChange: [autoIncrementVersion],    // Bump version on status → 'active'
  },
}
```

### 4.2 Rendering Engine

**Location:** `src/templates/engine.ts` (new file)

The engine is a **Handlebars-subset** — deliberately limited to keep the bundle small and avoid arbitrary code execution.

**Supported syntax:**

| Feature     | Syntax                             | Example                                       |
| ----------- | ---------------------------------- | --------------------------------------------- |
| Variable    | `{{ name }}`                       | `Hello {{ user.firstName }}`                  |
| Conditional | `{{#if expr}}…{{else}}…{{/if}}`    | `{{#if order.shipped}}Shipped!{{/if}}`        |
| Loop        | `{{#each items}}…{{/each}}`        | `{{#each order.items}}{{this.name}}{{/each}}` |
| Formatter   | `{{ fmt value "pattern" }}`        | `{{ date createdAt "MMM d, yyyy" }}`          |
| HTML escape | auto (use `{{{ raw }}}` to bypass) | `{{{ htmlContent }}}`                         |
| Fallback    | `{{ name \| default "Guest" }}`    | `{{ user.name \| default "there" }}`          |

**Built-in formatters:**

- `date` — date formatting via `Intl.DateTimeFormat` (no `date-fns` dep).
- `currency` — `Intl.NumberFormat` with currency code.
- `uppercase`, `lowercase`, `capitalize` — string transforms.
- `truncate` — truncate with ellipsis (useful for SMS).

**Security:** All output is HTML-escaped by default. Template compilation rejects `{{…}}` expressions containing function calls, `new`, `import`, or property access beyond a configurable depth (default: 5).

**Implementation strategy:** Compile template string → AST at save time (stored as `compiledAst` JSON field, excluded from admin). Render at send time by walking the AST — avoids repeated parsing and enables validation at authoring time.

### 4.3 Channel Adapter Upgrades

Each adapter's `send()` function changes from receiving a raw `body` string to receiving a `RenderedTemplate` object:

```typescript
type RenderedTemplate = {
  // Channel-specific fields (only the relevant ones are populated)
  subject?: string // email
  htmlBody?: string // email
  textBody?: string // email, fallback
  body?: string // sms, whatsapp, inapp
  title?: string // inapp
  hsmTemplateId?: string // whatsapp (Meta HSM)
  hsmParams?: string[] // whatsapp (Meta HSM)
  metadata?: {
    smsSegments?: number // sms segment count
    smsCharCount?: number // sms character count
    templateSlug?: string
    templateVersion?: number
  }
}
```

**Email adapter** — gains support for wrapping `htmlBody` in a layout template (header, footer, styles). Layout is resolved by slug from a `layouts` sub-field or a default.

**WhatsApp adapter** — if `hsmTemplateId` is present, sends a Meta HSM template message instead of a plain text message. Maps `hsmParams` to the HSM's component parameters.

**SMS adapter** — computes GSM-7 vs. UCS-2 encoding, character count, and segment count. Logs these in the delivery metadata. Optionally warns if a template exceeds a configurable segment limit.

**In-app adapter** — stores `title` and `body` as rendered strings (already the behavior since v0.1.1).

### 4.4 `campaigns` Collection

**Slug:** `campaigns`

```typescript
{
  slug: 'campaigns',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name',     type: 'text', required: true },
    { name: 'template', type: 'relationship', relationTo: 'notification-templates', required: true },
    { name: 'channels', type: 'select', hasMany: true,
      options: ['email', 'sms', 'whatsapp', 'inapp'] },
    { name: 'audience', type: 'group', fields: [
      { name: 'type',   type: 'select', options: ['all', 'filter', 'segment'], defaultValue: 'all' },
      { name: 'filter', type: 'json', admin: { description: 'Payload where-clause for user query' } },
      { name: 'segmentRef', type: 'text', admin: { description: 'External segment ID' } },
    ]},
    { name: 'schedule', type: 'group', fields: [
      { name: 'type',   type: 'select', options: ['immediate', 'scheduled'], defaultValue: 'immediate' },
      { name: 'sendAt', type: 'date', admin: { condition: (_, { schedule }) => schedule?.type === 'scheduled' } },
    ]},
    { name: 'status', type: 'select',
      options: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'],
      defaultValue: 'draft' },
    { name: 'classification', type: 'select', options: ['transactional', 'marketing'], defaultValue: 'marketing' },

    // A/B testing (optional)
    { name: 'abTest', type: 'group', fields: [
      { name: 'enabled',        type: 'checkbox', defaultValue: false },
      { name: 'variants',       type: 'array', fields: [
        { name: 'template',     type: 'relationship', relationTo: 'notification-templates' },
        { name: 'weight',       type: 'number', min: 1, max: 100 },
      ]},
      { name: 'holdoutPercent', type: 'number', min: 0, max: 50, defaultValue: 10 },
      { name: 'evalWindow',    type: 'number', admin: { description: 'Hours to wait before picking winner' } },
      { name: 'winnerMetric',  type: 'select', options: ['delivery', 'open', 'click'] },
    ]},

    // Aggregated stats
    { name: 'stats', type: 'group', fields: [
      { name: 'totalAudience', type: 'number', defaultValue: 0 },
      { name: 'sent',          type: 'number', defaultValue: 0 },
      { name: 'delivered',     type: 'number', defaultValue: 0 },
      { name: 'failed',        type: 'number', defaultValue: 0 },
      { name: 'opened',        type: 'number', defaultValue: 0 },
      { name: 'clicked',       type: 'number', defaultValue: 0 },
    ]},
  ],
}
```

### 4.5 Campaign Processor Job

**Task name:** `notification:process-campaign`

```
Input: { campaignId: string }

Steps:
  1. Fetch campaign document. Abort if status ∉ {scheduled, sending}.
  2. Update status → 'sending'.
  3. Resolve audience:
     - 'all'    → paginated payload.find({ collection: userCollectionSlug })
     - 'filter' → paginated payload.find({ collection: userCollectionSlug, where: filter })
     - 'segment' → call pluggable audienceResolver(segmentRef)
  4. For each page of users (default page size: 500):
     a. If A/B enabled:
        - hash(campaignId + userId) % 100 → assign to variant or holdout
        - Select template from variant
     b. For each channel:
        - Queue `notification:send` task with { userId, channel, template, campaignId, classification }
     c. Increment stats.sent
  5. After all pages processed → status = 'sent'.
  6. If A/B enabled:
     - Schedule `notification:evaluate-ab` job after evalWindow hours.
```

### 4.6 A/B Testing

**Variant assignment** uses a deterministic hash to ensure the same user always gets the same variant, even if the campaign is paused and resumed:

```typescript
function assignVariant(
  campaignId: string,
  userId: string,
  variants: Variant[],
  holdoutPercent: number,
) {
  const hash = fnv1a(`${campaignId}:${userId}`) % 100
  if (hash < holdoutPercent) return { type: 'holdout' }
  const adjusted = ((hash - holdoutPercent) / (100 - holdoutPercent)) * 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (adjusted < cumulative) return { type: 'variant', template: variant.template }
  }
  return { type: 'variant', template: variants[variants.length - 1].template }
}
```

**Winner evaluation** (`notification:evaluate-ab` job):

1. Query `notification-logs` grouped by variant template and campaignId.
2. Compute metric (delivery rate, open rate, or click rate) per variant.
3. Select variant with highest metric.
4. Send holdout users the winning template.
5. Record winner in campaign document.

### 4.7 Analytics Extension

Extend `notification-logs` with:

```typescript
{ name: 'campaignId', type: 'text', index: true }
{ name: 'abVariant',  type: 'text' }
{ name: 'opened',     type: 'checkbox', defaultValue: false }
{ name: 'openedAt',   type: 'date' }
{ name: 'clicked',    type: 'checkbox', defaultValue: false }
{ name: 'clickedAt',  type: 'date' }
```

**Open tracking (email):** Inject a 1×1 transparent tracking pixel at the bottom of HTML emails. The pixel URL encodes the log document ID. A lightweight endpoint (`/api/notifications/track/open/:logId`) marks the log as opened.

**Click tracking (email):** Rewrite links in HTML emails to route through `/api/notifications/track/click/:logId?url=<original>`. The endpoint marks the log as clicked and redirects to the original URL.

Both tracking endpoints are opt-in and disabled by default. They are configured via:

```typescript
notificationsPlugin({
  campaigns: {
    tracking: {
      opens: true, // default: false
      clicks: true, // default: false
      baseUrl: 'https://yourapp.com',
    },
  },
})
```

---

## 5 Migration & Backward Compatibility

### 5.1 Template Migration

On plugin initialization (via `onInit` hook), if the `notification-templates` collection is empty and `templates.registry` is configured:

1. For each entry in the code registry, create a `notification-templates` document with:
   - `slug` = registry key (e.g., `order.paid`)
   - `status` = `active`
   - `version` = 1
   - Channel content mapped from the registry's flat `{ subject, title, body }` structure
2. Skip if a document with that slug already exists (idempotent).
3. Log migration results via the observability hook.

### 5.2 API Compatibility

- `emitNotificationEvent()` continues to work exactly as before.
- `resolveTemplate()` gains DB lookup but falls back to code registry.
- `NotificationRule.template` field accepts both a slug (resolved from DB/registry) and a legacy registry key.
- No breaking changes to the plugin options schema; `campaigns` is a new optional top-level key.

### 5.3 Collection Compatibility

- `notification-logs` gains new optional fields (`campaignId`, `abVariant`, `opened`, `clicked`, etc.) — all optional, no impact on existing logs.
- New collections (`notification-templates`, `campaigns`) are only registered if `templates.collection` or `campaigns` options are enabled (both default to `false` initially, then `true` in a future major version).

---

## 6 File Structure (Proposed)

New and modified files:

```
src/
├── collections/
│   ├── NotificationTemplates.ts    # NEW — template collection definition
│   └── Campaigns.ts                # NEW — campaign collection definition
├── templates/
│   ├── engine.ts                   # NEW — rendering engine (compile + render)
│   ├── engine.test.ts              # NEW — engine unit tests
│   ├── resolve.ts                  # MODIFIED — DB-first resolution
│   ├── render.ts                   # MODIFIED — delegates to engine for new templates
│   └── migrate.ts                  # NEW — registry → collection migration
├── campaigns/
│   ├── processor.ts                # NEW — campaign processing job
│   ├── audience.ts                 # NEW — audience resolution logic
│   ├── abtest.ts                   # NEW — A/B assignment + evaluation
│   └── tracking.ts                 # NEW — open/click tracking endpoints
├── channels/
│   ├── email.ts                    # MODIFIED — HTML layout wrapping, tracking pixel
│   ├── sms.ts                      # MODIFIED — segment count awareness
│   └── whatsapp.ts                 # MODIFIED — HSM template support
├── jobs/
│   ├── processCampaign.ts          # NEW — campaign processor task handler
│   └── evaluateAbTest.ts           # NEW — A/B evaluation task handler
├── types.ts                        # MODIFIED — new types for templates, campaigns
├── plugin.ts                       # MODIFIED — register new collections + tasks
└── index.ts                        # MODIFIED — export new types + functions
```

---

## 7 Phased Implementation Plan

### Phase 1: Unified Template Engine (Estimated: 3 milestones)

**Milestone 1a — Collection + Engine Core**

- Implement `notification-templates` collection
- Build rendering engine with conditionals, loops, formatters
- Update `resolveTemplate()` for DB-first resolution
- Write comprehensive unit tests for the engine

**Milestone 1b — Channel Adapter Upgrades**

- Introduce `RenderedTemplate` type
- Update email adapter: HTML layout wrapping
- Update WhatsApp adapter: HSM template support
- Update SMS adapter: character/segment counting
- Update in-app adapter: pass-through (minimal changes)

**Milestone 1c — Admin UI + Migration**

- Template editor view in Payload admin
- Live preview per channel
- "Send Test" action
- Auto-migration from code registry to collection
- Integration tests for the full template flow

### Phase 2: Campaign System (Estimated: 4 milestones)

**Milestone 2a — Collection + Processor**

- Implement `campaigns` collection
- Build `processCampaign` job handler
- Audience resolution (all, filter)
- Immediate send support

**Milestone 2b — Scheduling + Lifecycle**

- Scheduled send (cron-based trigger)
- Pause / resume / cancel status transitions
- Rate limiting awareness per provider

**Milestone 2c — A/B Testing**

- Variant assignment (hash-based)
- Holdout group management
- `evaluateAbTest` job handler
- Auto-winner selection and holdout send

**Milestone 2d — Analytics + Tracking**

- Extend `notification-logs` with campaign fields
- Open tracking pixel endpoint
- Click tracking redirect endpoint
- Campaign stats aggregation endpoint

### Phase 3: Polish & Ecosystem (Future)

- Push channel (FCM / APNs)
- Block-based email editor (Lexical integration)
- Webhook / event-triggered campaigns
- Per-locale template variants
- Template import / export

---

## 8 Open Questions

1. **Rendering engine choice:** Custom Handlebars-subset vs. adopting a micro-library like `eta` or `nunjucks`? The custom approach gives full control over security and bundle size but requires more implementation effort.

2. **Template versioning strategy:** Should publishing a new version create a new document (immutable versions) or update in place with a version counter? Immutable versions are safer for audit but increase storage.

3. **Campaign scheduling mechanism:** Use Payload's built-in job queue with a recurring scan, or rely on the host app's cron? The former is more portable; the latter may be more reliable for large-scale deployments.

4. **Tracking privacy:** Open/click tracking raises GDPR considerations. Should we require explicit opt-in per campaign, or is the global config flag sufficient?

5. **Collection registration gating:** Default `notification-templates` and `campaigns` collections to disabled (opt-in) for v0.2 to avoid surprising existing users, then enable by default in v1.0?

---

## 9 Risks & Mitigations

| Risk                                            | Mitigation                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Rendering engine security (template injection)  | Compile-time AST validation; block function calls, `new`, `import`; configurable depth limit           |
| Large campaign audience causing memory pressure | Paginated audience resolution (default 500 per page); async batch queuing                              |
| A/B test variant drift on campaign pause/resume | Deterministic hash-based assignment (same input → same variant)                                        |
| Breaking changes to existing template API       | DB resolution falls back to code registry; `RenderedTemplate` is a superset of current `string` output |
| Email tracking pixel blocked by clients         | Track as best-effort metric; do not gate campaign completion on open data                              |
| Increased collection count adding admin noise   | Gate new collections behind opt-in config flags                                                        |

---

## 10 Acceptance Criteria

See the [GitHub issue #30](https://github.com/technewwings/payload-notifications/issues/30) for the full acceptance checklist organized by phase.

---

## Appendix A: Example Template Document

```json
{
  "name": "Order Shipped",
  "slug": "order.shipped",
  "description": "Sent when an order's status changes to shipped",
  "category": "transactional",
  "status": "active",
  "version": 3,
  "channels": ["email", "sms", "whatsapp", "inapp"],
  "email": {
    "subject": "Your order #{{ order.id }} has shipped!",
    "htmlBody": "<h1>Good news, {{ user.firstName }}!</h1><p>Your order <strong>#{{ order.id }}</strong> is on its way.</p>{{#if order.trackingUrl}}<p><a href=\"{{ order.trackingUrl }}\">Track your package</a></p>{{/if}}",
    "textBody": "Good news, {{ user.firstName }}! Your order #{{ order.id }} is on its way.{{#if order.trackingUrl}} Track it here: {{ order.trackingUrl }}{{/if}}",
    "layout": "default"
  },
  "sms": {
    "body": "{{ user.firstName }}, your order #{{ order.id }} shipped! {{#if order.trackingUrl}}Track: {{ order.trackingUrl }}{{/if}}"
  },
  "whatsapp": {
    "body": "Hi {{ user.firstName }}, your order #{{ order.id }} has shipped! {{#if order.trackingUrl}}Track it here: {{ order.trackingUrl }}{{/if}}",
    "hsmTemplateId": "order_shipped_v2",
    "hsmParams": ["user.firstName", "order.id", "order.trackingUrl"]
  },
  "inapp": {
    "title": "Order Shipped",
    "body": "Your order #{{ order.id }} is on its way!"
  },
  "variables": [
    { "name": "user.firstName", "type": "string", "required": true },
    { "name": "order.id", "type": "string", "required": true },
    { "name": "order.trackingUrl", "type": "string", "required": false }
  ]
}
```

## Appendix B: Example Campaign Document

```json
{
  "name": "Spring Sale 2026",
  "template": "<ref:notification-templates/spring-sale>",
  "channels": ["email", "sms"],
  "audience": {
    "type": "filter",
    "filter": {
      "and": [
        { "role": { "equals": "customer" } },
        { "lastOrderAt": { "greater_than": "2025-12-01" } }
      ]
    }
  },
  "schedule": {
    "type": "scheduled",
    "sendAt": "2026-04-01T09:00:00Z"
  },
  "status": "scheduled",
  "classification": "marketing",
  "abTest": {
    "enabled": true,
    "variants": [
      { "template": "<ref:notification-templates/spring-sale-v1>", "weight": 45 },
      { "template": "<ref:notification-templates/spring-sale-v2>", "weight": 45 }
    ],
    "holdoutPercent": 10,
    "evalWindow": 24,
    "winnerMetric": "click"
  },
  "stats": {
    "totalAudience": 12500,
    "sent": 0,
    "delivered": 0,
    "failed": 0,
    "opened": 0,
    "clicked": 0
  }
}
```
