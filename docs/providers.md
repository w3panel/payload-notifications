# Provider setup guide

This document covers how to configure each supported provider for production use.

## Meta WhatsApp Cloud API

The Meta WhatsApp Cloud API lets you send WhatsApp messages directly through Meta's official Graph API.

### Setup steps

1. **Create a Meta Business account** at [business.facebook.com](https://business.facebook.com/).
2. **Create or select a Meta App** in the [Meta App Dashboard](https://developers.facebook.com/apps/) and add the WhatsApp product.
3. **Register a phone number** in the WhatsApp > API Setup section. Note the **Phone Number ID** displayed.
4. **Generate a System User access token** with the `whatsapp_business_messaging` permission:
   - Go to Business Settings > System Users
   - Create a system user (Admin role)
   - Generate a token with the `whatsapp_business_messaging` scope
   - This token does not expire (unlike temporary tokens from the API Setup page)
5. **Configure the plugin:**

```ts
notificationsPlugin({
  channels: ['whatsapp'],
  providers: {
    whatsapp: {
      provider: 'meta',
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    },
  },
})
```

### Environment variables

```env
META_WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx...
META_WHATSAPP_PHONE_NUMBER_ID=123456789012345
```

### How it works

The provider sends a POST request to:
```
https://graph.facebook.com/v25.0/{phoneNumberId}/messages
```

With a JSON body:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+15559876543",
  "type": "text",
  "text": { "preview_url": false, "body": "Your rendered template text" }
}
```

### Current limitations

- **Text messages only.** Template messages (pre-approved by Meta), media messages, interactive buttons, and list messages are not yet supported. These can be added in future releases.
- **24-hour messaging window.** You can only send freeform text messages to users who have messaged you within the last 24 hours. Outside this window, you must use a pre-approved message template (which this plugin does not yet support).
- **Rate limits.** Throughput depends on your [messaging tier](https://developers.facebook.com/docs/whatsapp/messaging-limits). New numbers start at Tier 1 (1,000 unique recipients per 24 hours).
- **Phone number format.** The plugin strips `whatsapp:` prefixes and non-numeric characters before sending to the API.

---

## Twilio SMS

Twilio's Programmable Messaging API provides SMS delivery worldwide.

### Setup steps

1. **Create a Twilio account** at [twilio.com](https://www.twilio.com/).
2. **Get your Account SID and Auth Token** from the Twilio Console dashboard.
3. **Get or provision a phone number** with SMS capability.
4. **Configure the plugin:**

```ts
notificationsPlugin({
  channels: ['sms'],
  providers: {
    sms: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_SMS_FROM,
    },
  },
})
```

### Environment variables

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_SMS_FROM=+15551234567
```

### How it works

The provider sends a POST request to:
```
https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json
```

With URL-encoded form data (`To`, `From`, `Body`) and HTTP Basic Authentication using `accountSid:authToken`.

---

## Twilio WhatsApp

Twilio also provides WhatsApp messaging through the same Messages API, using `whatsapp:` prefixed phone numbers.

### Setup steps

1. **Enable WhatsApp** in your Twilio Console under Messaging > Try it out > Send a WhatsApp message.
2. **For production**, submit a WhatsApp Business Profile for approval through Twilio.
3. **Configure the plugin:**

```ts
notificationsPlugin({
  channels: ['whatsapp'],
  providers: {
    whatsapp: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_WHATSAPP_FROM,
    },
  },
})
```

### Environment variables

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_FROM=whatsapp:+15551234567
```

### How it works

Uses the same Twilio Messages API as SMS, but prefixes both `To` and `From` with `whatsapp:`. The plugin automatically adds the prefix if missing from the recipient number.

---

## Using multiple channels together

You can configure multiple providers simultaneously:

```ts
notificationsPlugin({
  channels: ['email', 'whatsapp', 'sms', 'inapp'],
  providers: {
    email: {
      defaultFromAddress: 'noreply@example.com',
    },
    whatsapp: {
      provider: 'meta',
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    },
    sms: {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_SMS_FROM,
    },
  },
})
```

The plugin validates all provider credentials at initialization. If required fields are missing, it throws a descriptive error before the application starts.

## Error handling

Providers throw `ProviderError` with the HTTP status. Trigger-based deliveries classify failures as:

- **`retryable`** (429, 502, 503): re-queued with a back-off
- **`permanent`** (other 4xx): failed, with fallback if configured
- **`unknown`** (timeouts, 5xx): never re-sent automatically

Status webhooks (`/api/payload-notifications/webhooks/twilio` and `/webhooks/meta`) record
delivered / read / failed and STOP replies. See [reliability.md](./reliability.md) for retries,
fallback, webhooks, custom providers (`providers.custom`) and reconciliation.

Direct `queueNotificationSend` calls keep the older behaviour: retriable failures throw so Payload
retries the job.
