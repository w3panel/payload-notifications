# Admin template studio

## What you get (Phase 1c)

On each `notification-templates` document:

- Richer editors: email `htmlBody` / `textBody` as **code** fields
- **Template studio** UI field: channel picker, JSON sample context, **Preview**, **Send test**, engine cheatsheet
- Collection endpoints:
  - `POST /api/notification-templates/preview`
  - `POST /api/notification-templates/test-send`

Authenticated admin users only (`req.user` required).

## Import map

The studio field is registered as:

```ts
Field: '@wtree/payload-notifications/admin#TemplateStudioField'
```

After adding/upgrading the package, regenerate the Payload import map in the host app so the admin bundle can resolve the component. The host must provide `react` and `@payloadcms/ui`.

Package export: `@wtree/payload-notifications/admin`.

## Preview

1. Open a template in admin  
2. Fill channel content (including drafts)  
3. In **Template studio**, adjust sample JSON context  
4. Click **Preview**

Body (and optional subject/title) appear as text; email also shows an HTML iframe when `htmlBody` renders.

Request shape:

```json
{
  "channel": "email",
  "doc": { "slug": "order.paid", "email": { "subject": "...", "htmlBody": "..." } },
  "context": {
    "event": "order.paid",
    "userId": "user_1",
    "payload": { "orderId": "ORD-1" }
  }
}
```

## Test send

1. Enter a real `userId` that has email/phone for the channel  
2. Click **Send test**  
3. Delivery uses the same channel adapters as production  
4. Logs may include `meta.testSend: true`

Does **not** require the template to be `active` — uses current form/`doc` values.

## Draft → active workflow

1. Create template as `draft`  
2. Preview / test-send until content looks right  
3. Set `status` to `active` (version increments)  
4. Point a rule `template` slug at it  
5. Emit domain events

## Out of scope

- Block / WYSIWYG email builder (RFC Phase 3)  
- Campaigns / A/B / open-click tracking (Phase 2)  
