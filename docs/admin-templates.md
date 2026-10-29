# Admin template studio

Every `notification-templates` document has a **Template studio** field. With it, admins:

- Design emails visually, or write the HTML by hand.
- Preview every channel with real sample data.
- Check accessibility and size.
- Compare and roll back versions.
- Send themselves a test.

## Import map

The studio and the partial designer are registered as:

```ts
Field: '@wtree/payload-notifications/admin#TemplateStudioField'
Field: '@wtree/payload-notifications/admin#PartialDesignerField'
```

After adding or upgrading the package, regenerate the Payload import map in the host app so the admin bundle can resolve the components. The host must provide `react` and `@payloadcms/ui`. Package export: `@wtree/payload-notifications/admin`.

## Visual email designer

Set **Email → Editor** to **Visual designer**, or click **Visual designer** in the studio. The design is stored as a versioned block document in `email.design`. On save, it is compiled into `email.htmlBody` and `email.textBody`. Sending, versions and code mode therefore keep working on HTML.

**Blocks**

| Block | Purpose |
|---|---|
| Section | Groups blocks, with a background and padding |
| Columns | 1–4 columns that stack on mobile (fluid hybrid layout, Outlook-safe) |
| Heading, Text, List | Text with **bold**, _italic_, links and `{{ variables }}` |
| Image | From `templates.mediaCollection` or an absolute URL; **alt text is required** |
| Button | Bulletproof button (`bgcolor` cell, works in Outlook) |
| Divider, Spacer | Layout |
| Social links | Text links (no hosted icons) |
| Footer | Theme footer text and an optional unsubscribe link |
| Repeat (line items) | `{{#each list}}`, with optional text for an empty list; item fields are used directly (`{{ name }}`) |
| Show if | `{{#if path}}` … otherwise … |
| Saved section | A partial from `notification-template-partials` |
| Raw HTML | Sent as-is; needs `access.rawHtml` (default: nobody) |

**Editing**

- Drag blocks from the palette or click one to add it after the selection.
- Drag blocks on the canvas to move them, including into sections, columns and loops.
- Keyboard shortcuts:
  - ↑/↓ select blocks; Alt+↑/↓ move the selected block.
  - Delete removes it; Ctrl/Cmd+C, V and D copy, paste and duplicate.
  - Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes.
- Text fields have a formatting toolbar (B, I, Link, Insert variable) with the shortcuts Ctrl/Cmd+B, I and K.

**Variables**

- Typing `{{` opens autocomplete, fed by the variable contract of the template's event. Enter a trigger slug to use that trigger's data sources instead.
- Variables appear as chips on the canvas. Unknown or invalid ones are red and listed on the block.

**Inline markup safety:** text can only produce escaped `{{ path }}` expressions. If someone types triple braces or block tags (`{{#if}}`) into text, they stay literal, so text cannot inject HTML. Link targets other than `http(s)`, `mailto`, `tel`, relative paths or `{{ variable }}` URLs are dropped.

## Brand theme and partials

- **`notification-theme`** (global) sets the logo (an upload when `templates.mediaCollection` is set), colours, fonts, button radius and footer text. Visual templates inherit it; each design's settings override it.
- **`notification-template-partials`** holds reusable headers, footers and sections, edited with the same designer. Every design change bumps the partial's `version` and keeps the previous design in `history`. A template uses the latest version unless its **Saved section** block pins one.

Theme and partial changes apply to a template the next time it is saved or published, because publishing recompiles the stored design. Published versions keep the HTML they were published with.

## Media

Set `templates.mediaCollection` (for example `media`) to pick images from a Payload upload collection. On save, image URLs are made absolute with `templates.mediaBaseUrl` or `serverURL`. Saving fails when an image has no alt text or no absolute URL, including images inside partials.

## Code mode

Click **HTML code** to convert a visual email. The design, with its theme, partials and media, is compiled into the HTML and text bodies.

- **One-way:** later code edits are not copied back. A warning asks you to confirm.
- **Switching back:** going back to the visual designer warns that saving will replace the code.
- **Variables:** in code mode, Payload's HTML and text editors get `{{` variable autocomplete. A panel lists the available variables (click to copy) and any unknown variables the code uses.

`POST /api/notification-templates/compile-design { design, locale? }` returns the compiled `html` and `text`.

## Preview

Choose a channel, or **All template channels**, and the sample data:

| Sample data | Source |
|---|---|
| Event sample | The event's registered `samplePayload` |
| Real document | A document of a `collectionEvents` collection, read with **your** access (captured fields only) |
| Trigger test data | The trigger's event and data sources (collection triggers also need a document ID) |
| Custom JSON | `{ "payload": { … } }` |

- **Email:** shows the rendered subject and preheader, desktop and mobile widths, and a dark-mode simulation.
- **SMS:** shown in a phone with characters, encoding, segments and characters left.
- **WhatsApp:** a chat bubble. Approved templates show their name, language, approval status and `{{n}}` values.
- **In-app:** a notification card.

**Email checks**

| Check | Level |
|---|---|
| Images without alt text | error |
| Links without text | error |
| Generic link text ("click here") | warning |
| Colour contrast below WCAG AA, from the design and theme | warning |
| HTML over 102 KB (Gmail clips the message) | warning |

Request shape:

```json
{
  "channel": "email",
  "doc": { "slug": "order.paid", "email": { "editor": "visual", "design": { "version": 1, "blocks": [] } } },
  "sample": { "kind": "event" }
}
```

`sample` may also be `{ "kind": "document", "collection": "orders", "id": "…" }` or `{ "kind": "trigger", "trigger": "slug", "documentId?": "…" }`. Without `sample`, `context` (the JSON context) is used. The response includes `rendered` and, for email, `checks`.

## Test send

**Send test … to me** sends exactly what the preview shows to **your own account**: the unsaved form values, the chosen channel and sample data, and channel finishing.

- **Marking:** the subject, title or SMS/WhatsApp text starts with `[Test]`. Approved WhatsApp templates are sent unchanged.
- **Logs:** attempt logs carry `meta.testSend: true`.
- **API:** `POST /api/notification-templates/test-send` accepts the same body as the preview. A `userId` other than the caller's is rejected.
- **Permission:** requires `access.testSend`.

## Versions

The **Versions** panel:

- Publishes the saved template. This is blocked while the form has unsaved edits.
- Lists published versions, and rolls back to any of them (the old version is published as a new one).
- Compares two versions, or a version with the current draft. You get a field-by-field line diff, with compiled HTML split one tag per line, plus side-by-side email previews.

Publishing and rollback need `access.publishTemplates`. See [templates.md](./templates.md#publishing-and-rollback).

## Draft → active workflow

1. Create the template as `draft`.
2. Design, preview and test-send until the content looks right.
3. Publish from the Versions panel, set `status` to `active`, or call `POST /api/notification-templates/:id/publish`. Each publish saves an immutable version.
4. Point a trigger delivery's `template` at the slug.
5. Emit domain events.

Later edits to an active template show **unpublished changes**. Sends keep using the published version until you publish again.

## Out of scope

- Campaigns, A/B tests, open and click tracking
- MJML import and export
