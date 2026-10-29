# Preferences and policy

At send time, every delivery is checked in this order:

1. **Suppression list:** the destination bounced, complained, replied STOP, is invalid, or was
   suppressed manually.
2. **Preferences:** in user-fields mode (the default) these come from fields on the user. In
   collection mode they're records in `notification-preferences`, and mandatory categories skip
   this step.
3. **`policy.canSend`**

Trigger settings never override consent.

## Preference field mapping

Defaults assume nested user fields:

```ts
preferences: {
  fields: {
    channels: 'notificationPreferences.channels',
    marketingConsent: 'notificationPreferences.marketing',
  },
}
```

Expected shapes (examples):

```ts
user.notificationPreferences = {
  channels: { email: true, sms: false, whatsapp: true, inapp: true },
  marketing: true,
}
```

Missing maps → channel allowed; marketing consent only enforced when event `classification === 'marketing'`.

## Classification

Emit with:

```ts
classification: 'transactional' | 'marketing'
```

`processEvent` stores the classification (trigger `classification`, else the event's) on each delivery, and `notification:send` re-checks preferences and marketing consent against the current user at send time.

## Custom `policy.canSend`

Runs after preference checks:

```ts
policy: {
  canSend: ({ channel, classification, user, event, payload }) => ({
    allow: !(channel === 'sms' && user.plan === 'free'),
    reason: 'SMS disabled for free plan',
  }),
}
```

Denied sends are logged as `skipped` (terminal — not retried).

## Collection mode

```ts
preferences: {
  mode: 'collection',
  mandatoryCategories: ['transactional'], // default: non-marketing deliveries ignore opt-outs
  marketingRequiresOptIn: true,           // default false
  unsubscribe: { secret: process.env.UNSUBSCRIBE_SECRET!, baseUrl: 'https://shop.example.com' },
}
```

- **Records:** `notification-preferences` holds one record per user × channel × category, where `*`
  means "any". The record also stores `enabled`, `consentAt` and `consentSource`. Users can read
  and change their own records; admins (`access.isAdmin`) can change all of them.
- **Matching:** the most specific record wins: category + channel, then category + `*`, then
  `*` + channel, then `*` + `*`.
- **Categories:** a trigger's `category` (e.g. `newsletter`, `order-updates`) is what users opt out
  of. It defaults to the classification.

### One-click unsubscribe

With `unsubscribe` set, every delivery users can opt out of gets:

- `{{ unsubscribeUrl }}` in the template context
- `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers on email

The link points to `/api/payload-notifications/unsubscribe?token=…`. The token is signed with HMAC
using Web Crypto. A `GET` shows a confirmation page; a `POST` records an opt-out with source
`unsubscribe-link`.

## Suppressions

`notification-suppressions` is always registered. It holds normalized email addresses and E.164
phone numbers, each with a reason: `bounce`, `complaint`, `stop`, `invalid` or `manual`.

- **Automatic entries:** provider webhooks add STOP replies and invalid numbers
  (see [reliability.md](./reliability.md#webhooks)).
- **Email bounces:** add these yourself with `recordSuppression()`.
