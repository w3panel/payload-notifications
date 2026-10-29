# Preferences and policy

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
