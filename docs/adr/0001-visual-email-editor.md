# ADR 0001: Visual email editor

- Status: accepted
- Date: 2026-10-29
- Phase: 7.1 (Visual Template Studio)

## Context

Non-technical admins need to design notification emails visually inside the Payload admin.
The output must keep working with the existing template engine (`{{ path }}`, `{{#if}}`,
`{{#each}}`, formatters), stay safe in Gmail and Outlook, and ship inside this plugin's
admin bundle.

Constraints from this plugin and its hosts:

- The plugin has **no runtime dependencies**; React and `@payloadcms/ui` are optional peers.
- It supports **Payload 3 and Payload 4** (React 19) from one build.
- Hosts run on Node **and Cloudflare Workers** (electrofit: single Worker, D1, R2). Email HTML is
  compiled on the server when a template is saved, so the compiler must run without Node APIs.
- Licences must be open source; no paid or hosted embeds (Unlayer, Beefree, Stripo).

## Options

| | Custom React block editor | GrapesJS + MJML preset | Lexical blocks |
|---|---|---|---|
| Licence | ours (MIT) | BSD-3 / MIT | MIT |
| Admin bundle cost | small: plain React, no new deps | large: GrapesJS core plus `mjml-browser`, hundreds of KB | moderate core, plus a custom email layer |
| Email-safe output | own table-based compiler, snapshot-tested | MJML output is email-safe | none: it is a rich-text editor; layout and email HTML would still be ours |
| Server compile on Workers | yes (pure TypeScript) | MJML's server package needs Node; the browser build is large | n/a |
| React 19 / Payload admin fit | native React components, Payload theme variables | separate non-React canvas in an iframe; styling and state bridged by hand | React bindings exist |
| Engine integration (loops, conditions, variables) | first-class blocks that emit `{{#each}}` / `{{#if}}` / `{{ path }}` | custom components and MJML tags would have to emit engine syntax | custom nodes |
| Extensibility | block registry in our code | GrapesJS plugin API | node registry |

## Decision

Build a **custom React block editor** with a versioned JSON block model (`email.design`) and our
own **table-based, inline-styled HTML compiler** that also produces plain text.

- Drag and drop uses the native HTML5 drag events, with keyboard equivalents for every action. This
  avoids adding `@dnd-kit` as a dependency; it can be added later if needed.
- Inline formatting (bold, italic, links, variables) is stored as a small markup inside block
  text and compiled to escaped HTML. It is never stored as raw HTML.
- The compiler runs on save on the server (Node or Workers), so `htmlBody` / `textBody` stay
  the source of truth for sending, versioning and code mode.

## Consequences

- No new runtime dependencies; the admin bundle grows only by our own components.
- We own email-client compatibility: compiler output is snapshot-tested and uses the
  conservative subset (nested tables, inline styles, `role="presentation"`, MSO-safe buttons).
- A raw HTML block exists for edge cases but needs the `access.rawHtml` permission.
- MJML import/export is out of scope; it could be added later as a converter to and from the block model.
