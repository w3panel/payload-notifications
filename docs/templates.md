# Templates

## Resolution order

`resolveTemplate()` is **DB-first**, then **code registry**:

1. Active `notification-templates` doc where `slug` equals the rule `template` key (`status: 'active'`, highest `version`)
2. Else `options.templates.registry` (merged over package starters)

Sync helper `resolveTemplateSync()` only reads the registry (no DB).

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
| `slug` | Match this from `rules[].template` |
| `status` | Only `active` is used at send time |
| `version` | Auto-increments when transitioning to `active` |
| `channels` | Controls which channel groups show |
| `email.htmlBody` / `textBody` | HTML preferred for email `html`; text for MIME text |
| `variables` | Author documentation only (not hard-enforced) |

Draft templates can still be **previewed** / **test-sent** from admin using current form values.

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
