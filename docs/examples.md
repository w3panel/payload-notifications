# End-to-end examples

Two complete workflows live in [`examples/`](../examples). Both are runnable code, and both are tested on a real Payload instance, so they stay correct. Copy one into your app as a starting point.

## E-commerce: order paid ([`examples/order-paid`](../examples/order-paid))

An `order.paid` event sends the customer an email, a WhatsApp message and an in-app notification. The content uses the order, the customer and the store, loaded by data sources.

1. **Collections:** `users`, `stores`, and `orders` (with `customer` and `store` relationships).
2. **Allowlist:** `data.collections` lists the order, user and store fields that templates may read. `internalNotes` is not listed, so templates can never read it.
3. **Trigger:** event `order.paid`.
   - **Data sources:** `order` (by `event.payload.orderId`), `customer` (the order's `customer`), and `store` via a resolver.
   - **Deliveries:** email, WhatsApp and in-app to the customer.
   - **Dedupe:** `order.paid:{{ order.id }}`, so a repeated payment webhook sends nothing twice.
4. **Emit** from your payment code:

   ```ts
   await emitNotificationEvent({
     payload,
     req, // inside a hook / transaction
     event: {
       name: 'order.paid',
       userId: String(order.customer),
       idempotencyKey: `order.paid:${order.id}`,
       payload: { orderId: order.id },
     },
   })
   ```

Test: [`tests/orderPaidWorkflow.test.ts`](../tests/orderPaidWorkflow.test.ts).

## Booking: appointments ([`examples/booking`](../examples/booking))

Appointments for a clinic (the same pattern fits salons and classes). No code emits events here: the `appointments` collection is a `collectionEvents` source, and triggers react to its status changes.

| Trigger | When | Who | What |
|---|---|---|---|
| `appointment-confirmed` | `status` changes to `confirmed` | patient, doctor | Email and in-app to the patient; in-app to the doctor (the `doc.doctor` relationship) |
| `appointment-reminder` | same change, sent **24 h before `startsAt`** | patient | Email. Re-checked when due, so it is cancelled if the appointment was cancelled; skipped if booked less than 24 h ahead |
| `appointment-cancelled` | `status` changes to `cancelled` | patient, doctor | Email to the patient, in-app to the doctor |

Key parts:

```ts
collectionEvents: {
  appointments: { operations: ['update'], capture: ['status', 'startsAt', 'doctor', 'clinic'], userField: 'patient' },
}
// …
schedule: { type: 'relative', at: 'doc.startsAt', offset: '-24h', recheckConditions: true, skipIfPast: true }
```

Test: [`tests/integration/booking.test.ts`](../tests/integration/booking.test.ts). It confirms, cancels before the reminder (the reminder becomes `cancelled`), sends the reminder for a still-confirmed appointment, and skips it for one less than 24 h away.

### Going further

- **WhatsApp:** add a `whatsapp` delivery with an approved template (`whatsapp.hsmTemplateId` on the DB template). Use `fallback: [{ channel: 'sms' }]` for patients without WhatsApp.
- **Multi-clinic apps:** `tenancy: { field: 'clinic' }` keeps deliveries and the overview per clinic ([operations-admin.md](./operations-admin.md#tenants)).
- **Quiet hours** move marketing messages out of the night ([automation.md](./automation.md#scheduling)).
- **Admins** can restyle the emails in the visual designer, or add their own triggers (for example a follow-up survey) without a deploy ([admin-templates.md](./admin-templates.md), [admin-triggers.md](./admin-triggers.md)).
