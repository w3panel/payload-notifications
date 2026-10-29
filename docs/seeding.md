# Seeding templates from the registry

## Why

Starter / app registry entries live in code. Seeding copies them into `notification-templates` so non-devs can edit content in admin without redeploying.

## Manual API

```ts
import {
  normalizePluginOptions,
  seedTemplatesFromRegistry,
} from '@wtree/payload-notifications'

const options = normalizePluginOptions({
  /* same options as the plugin */
})

const result = await seedTemplatesFromRegistry({ payload, options })
// { created: ['order.paid', ...], skipped: ['already-there'], updated: [] }

// Later, after the code registry changed:
await seedTemplatesFromRegistry({ payload, options, updateUnedited: true })
```

Behavior:

- Idempotent: existing `slug` rows are **skipped** (never overwritten)
- Seeded documents get `source: 'seed'` and a content hash. With `updateUnedited: true`, seeded documents **nobody has edited** are republished (as a new version) with the current registry content; anything an admin changed is left alone
- Only the default (no-locale) variant is seeded  
- Creates `status: 'active'`, `version: 1`, `category: 'transactional'`  
- Maps registry email/sms/whatsapp/inapp into channel groups  

## `templates.seedOnInit`

```ts
notificationsPlugin({
  templates: {
    seedOnInit: true, // default false
    registry: {
      // optional app overrides merged over package starters
    },
  },
})
```

On Payload `onInit`, if `seedOnInit` is true, the plugin runs `seedTemplatesFromRegistry`. Failures are logged and do not crash boot.

## Recommended workflow

1. Keep starters / overrides in `templates.registry` for version control  
2. Enable `seedOnInit` in staging/prod once, or run a one-shot script  
3. Edit activated DB templates in admin going forward  
4. For content that must stay in code, leave DB slug absent so registry fallback wins  

See also [templates.md](./templates.md) and [admin-templates.md](./admin-templates.md).
