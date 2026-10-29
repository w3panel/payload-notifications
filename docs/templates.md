# Templates

## Resolution order

`resolveTemplate()` checks the database first, then the code registry. It works through locales
in this order: the recipient's locale (e.g. `hi-IN`), its language (`hi`),
`templates.defaultLocale`, and finally templates without a locale.

1. An active `notification-templates` document for the slug in that locale. Its **published
   snapshot** is rendered, and any later edits are ignored until they're published. A locale variant
   with no content for the channel falls through to the next locale.
2. Otherwise, `templates.localized[locale]`, and then `templates.registry` (merged over the package
   starters).

Deliveries **pin** the template version and locale when they're planned, so queued and scheduled
sends render the version that was live at event time. `resolveTemplateSync()` only reads the
registry.

## Code registry

```ts
notificationsPlugin({
  templates: {
    registry: {
      'order.paid': {
        email: {
          subject: 'Order {{ payload.orderId }} paid',
          body: 'Thanks {{ userId }}',
        },
        inapp: { title: 'Paid', body: 'Order {{ payload.orderId }} paid.' },
      },
    },
  },
})
```

Package starters (always merged unless overridden): `order.paid`, `order.shipped`, `auth.magic-link`.

## DB templates (`notification-templates`)

| Field | Notes |
|-------|--------|
| `slug` + `locale` | Unique together. `slug` matches a delivery's `template`; leave `locale` empty for the default variant |
| `status` | `draft`, `active` or `archived`; only `active` templates send |
| `version` | Published version. Becoming `active` or publishing creates an immutable snapshot in `notification-template-versions` |
| `hasUnpublishedChanges` | Set when an active template's content is edited; publish to make the edits live |
| `channels` | Controls which channel groups show |
| `email.subject` / `preheader` / `htmlBody` / `textBody` | HTML for email `html`; text for the MIME text part |
| `sms.body`, `whatsapp.body` | Text bodies |
| `whatsapp.hsmTemplateId` / `hsmLanguage` / `hsmParameters` | Pre-approved WhatsApp template, sent instead of `body` |
| `inapp.title` / `body` / `actionUrl` / `icon` / `priority` | In-app content |
| `variables` | Documented variables; `required` ones are checked on publish |

Draft templates can still be **previewed** and **test-sent** from admin using the current form
values.

> **Upgrading:** `slug` is no longer a unique index (it's unique *per locale*). SQL adapters,
> including D1, need a migration to drop the old unique constraint. Active templates created before
> snapshots existed keep rendering from the document until their next publish.

### Publishing and rollback

| Endpoint | Does |
| --- | --- |
| `POST /api/notification-templates/:id/publish` | Validates, then snapshots the current content as version N+1 and makes it active. Returns `warnings` |
| `POST /api/notification-templates/:id/rollback` `{ version }` | Republishes an earlier version as a new version |
| `POST /api/notification-templates/:id/whatsapp-status` | Syncs WhatsApp template approval from Meta |
| `GET /api/notification-templates/variables?event=…&trigger=…` | Variables available to authors |

Publish and rollback need `access.publishTemplates` (defaults to `access.isAdmin`).

Publishing is **blocked** when:

- a channel doesn't compile
- an email contains `javascript:`, `data:` or another unsafe link scheme
- a required variable isn't provided

Publishing still succeeds with a **warning** when:

- the template uses variables its event doesn't provide (checked when the slug is a registered event)
- the SMS is longer than 3 segments
- the WhatsApp template isn't approved

## Variables

`availableVariables()` lists what templates can use:

- `event`, `userId`
- `trigger.*`
- `recipient.name` / `email` / `locale` / `timezone`
- `unsubscribeUrl`
- `payload.*` from the event's `samplePayload`
- captured `doc.*` / `previous.*`
- data-source aliases

Inside `{{#each list}}`, plain names refer to the item, e.g. `{{ sku }}` is `list.0.sku`. Unknown
variables are flagged at template publish, admin trigger publish and startup.

## Channel content

- **Email:**
  - `preheader` adds hidden inbox preview text.
  - `templates.emailLayout` wraps every email, either as a template string with `{{{ content }}}`
    (plus `{{ subject }}` and `{{ preheader }}`) or as a function.
  - Unsafe link schemes are neutralised at render time too.
- **SMS / WhatsApp:**
  - Text is measured in GSM-7 / UCS-2 segments; the count is logged on attempts and shown in
    previews.
  - `templates.shortenLink(url)` shortens links before sending.
- **WhatsApp templates:**
  - With `hsmTemplateId` set, Meta sends a `template` message with the rendered `hsmParameters`.
    Twilio uses it as a Content SID with `ContentVariables`.
  - Sync approval with the endpoint above; this needs `providers.whatsapp.businessAccountId`.
  - Templates that aren't approved fail fast instead of being sent.
- **In-app:** `actionUrl` is templated and stored as `meta.link`, alongside `icon` and `priority`.

## Starter pack

```ts
notificationsPlugin({
  templates: { starterPack: true }, // or ['ecommerce', 'auth', 'saas']
})
```

The starter pack adds 20 events, each with a label, classification and sample payload, plus email,
SMS, WhatsApp and in-app templates:

- **E-commerce:** `order.paid`, `order.shipped`, `order.delivered`, `order.cancelled`,
  `payment.failed`, `cart.abandoned`, `refund.processed`
- **Auth:** `auth.magic-link`, `auth.otp`, `auth.password-reset`, `user.welcome`,
  `user.email-verified`
- **SaaS:** `subscription.created`, `subscription.renewal-reminder`, `subscription.payment-failed`,
  `invoice.created`, `booking.confirmed`, `booking.reminder`, `ticket.updated`, `system.alert`

Your own `templates.registry` and `events` entries win. Seed the templates into the database to
edit them in admin (see [seeding.md](./seeding.md)).

## Engine syntax

Handlebars-subset (`src/templates/engine.ts`):

- `{{ event }}`, `{{ userId }}`, `{{ payload.orderId }}`
- `{{#if expr}}…{{else}}…{{/if}}`
- `{{#each items}}…{{/each}}` with `@index` / `@first` / `@last`
- Formatters: `date`, `currency`, `uppercase`, `lowercase`, `capitalize`, `truncate`
- Defaults: `{{ payload.name | default "Guest" }}`
- HTML auto-escapes `{{ }}` inside `htmlBody`; use `{{{ raw }}}` only when intentional

Plain-text channels render with unescaped interpolation. Email `htmlBody` uses escaped interpolation by default.

## Rule overrides

```ts
{
  event: 'order.paid',
  channels: ['email'],
  template: 'order.paid',
  templateOverrides: {
    email: { subject: 'Custom {{ payload.orderId }}' },
  },
}
```

Overrides merge into the resolved definition before render.
