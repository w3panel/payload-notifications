# End-to-end expectations

Happy path for dynamic, admin-editable notifications:

```mermaid
flowchart LR
  seed[Seed or create template] --> activate[status active]
  activate --> rule[Add plugin rule]
  rule --> emit[emitNotificationEvent]
  emit --> process[notification:process-event]
  process --> send[notification:send]
  send --> channel[email / sms / whatsapp / inapp]
  channel --> logs[notification-logs]
```

## Checklist

1. **Install plugin** and configure `channels` + providers ([getting-started.md](./getting-started.md))  
2. **Seed** starters (`templates.seedOnInit` or `seedTemplatesFromRegistry`) ([seeding.md](./seeding.md))  
3. **Edit** templates in admin; use **Preview** / **Send test** ([admin-templates.md](./admin-templates.md))  
4. Set template `status` to **`active`**  
5. **Register a rule** for your event name + channels + template slug ([rules-and-triggers.md](./rules-and-triggers.md))  
6. From a domain action, **`emitNotificationEvent`** with `userId`, `classification`, `idempotencyKey`, payload  
7. Ensure the **`notifications` jobs queue** is drained ([jobs-and-operations.md](./jobs-and-operations.md))  
8. Verify **`notification-logs`** and (for in-app) **`notifications`**  
9. Optionally hook **`observability.onDispatch`** and preferences/policy ([preferences-and-policy.md](./preferences-and-policy.md), [observability.md](./observability.md))  

## Dynamic content expectations

| Layer | Dynamic? |
|-------|----------|
| Template body in DB | Yes — admin editable without deploy |
| Tokens / conditionals | Yes — engine at send time |
| Channels per rule | Yes — rule config |
| Recipient prefs / marketing | Yes — user fields + policy |
| Retries | Yes — Payload job retries on retriable errors |

## Not included yet

- Visual block/WYSIWYG builder  
- Campaigns / scheduled blasts / A/B  
- Automatic open/click tracking  

Those remain RFC phases 2–3.
