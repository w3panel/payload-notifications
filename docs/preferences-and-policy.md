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

`processEvent` forwards classification into each `notification:send` job so marketing consent is enforced on the job path.

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
