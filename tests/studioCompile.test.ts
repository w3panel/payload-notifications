import { describe, expect, it } from 'bun:test'
import { compileDesign, VISUAL_DESIGN_MARKER } from '../src/studio/compile'
import { inlineExpressions, inlineToHtml, inlineToText } from '../src/studio/inline'
import type { EmailDesign } from '../src/studio/model'
import { changesRawHtml, compileVisualEmail } from '../src/studio/save'
import { renderTemplate } from '../src/templates/engine'
import { finalizeForChannel } from '../src/templates/channelContent'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

const orderDesign: EmailDesign = {
  version: 1,
  settings: { width: 600 },
  blocks: [
    { id: 'h', type: 'heading', text: 'Order **{{ payload.orderId }}** is confirmed', level: 1 },
    {
      id: 't',
      type: 'text',
      text: 'Hi {{ recipient.name | default "there" }},\n\nThanks for your _order_.',
    },
    {
      id: 'loop',
      type: 'loop',
      path: 'payload.items',
      emptyText: 'No items',
      children: [{ id: 'li', type: 'text', text: '{{ name }} × {{ qty }}' }],
    },
    {
      id: 'cond',
      type: 'conditional',
      path: 'payload.trackingNumber',
      children: [{ id: 'c1', type: 'text', text: 'Tracking: {{ payload.trackingNumber }}' }],
      elseChildren: [{ id: 'c2', type: 'text', text: 'Tracking follows soon.' }],
    },
    {
      id: 'cols',
      type: 'columns',
      columns: [
        {
          width: 50,
          children: [
            { id: 'img', type: 'image', src: 'https://cdn.example.com/p.png', alt: 'Product' },
          ],
        },
        {
          children: [{ id: 'b', type: 'button', label: 'Track order', href: '{{ payload.url }}' }],
        },
      ],
    },
    { id: 'd', type: 'divider' },
    { id: 'l', type: 'list', items: ['Fast delivery', '[Returns](https://example.com/returns)'] },
    {
      id: 's',
      type: 'social',
      links: [{ network: 'instagram', url: 'https://instagram.com/acme' }],
    },
    { id: 'f', type: 'footer', text: 'Acme Inc.', includeUnsubscribe: true },
  ],
}

const context = {
  event: 'order.paid',
  recipient: { name: 'Asha' },
  unsubscribeUrl: 'https://example.com/u/1',
  payload: {
    orderId: 'ORD-<1>',
    url: 'https://example.com/t/1',
    items: [
      { name: 'Shoes', qty: 1 },
      { name: '<script>x</script>', qty: 2 },
    ],
  },
}

describe('inline markup', () => {
  it('renders bold, italic, links and variables as escaped HTML', () => {
    expect(inlineToHtml('a **b** _c_ [d](https://x.y) {{ name }} <i>')).toBe(
      'a <strong>b</strong> <em>c</em> <a href="https://x.y" target="_blank" rel="noopener">d</a> {{ name }} &lt;i&gt;',
    )
  })

  it('keeps raw output and block tags typed into text literal', () => {
    const html = inlineToHtml('{{{ payload.html }}} {{#if a}}x{{/if}} {{ ok }}')
    expect(html).not.toContain('{{{')
    expect(html).not.toContain('{{#if')
    expect(html).toContain('{{ ok }}')
    expect(renderTemplate(html, { payload: { html: '<b>' }, ok: 1 })).not.toContain('<b>')
  })

  it('drops unsafe link targets but keeps the label', () => {
    expect(inlineToHtml('[click](javascript:alert(1))')).toBe('click')
    expect(inlineToHtml('[go]({{ payload.url }})')).toContain('href="{{ payload.url }}"')
  })

  it('does not italicise snake_case words', () => {
    expect(inlineToHtml('snake_case_name')).toBe('snake_case_name')
  })

  it('renders plain text without markup', () => {
    expect(inlineToText('**Hi** _there_ [docs](https://d.x) {{ name }}')).toBe(
      'Hi there docs (https://d.x) {{ name }}',
    )
    expect(inlineExpressions('a {{ x.y }} {{{ raw }}} {{#if z}}')).toEqual(['x.y'])
  })
})

describe('compileDesign', () => {
  const compiled = compileDesign(orderDesign)

  it('produces Gmail/Outlook-safe markup (snapshot)', () => {
    expect(compiled.warnings).toEqual([])
    expect(compiled.html).toMatchSnapshot()
    expect(compiled.text).toMatchSnapshot()
  })

  it('uses tables, inline styles and Outlook fallbacks only', () => {
    const { html } = compiled
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain(VISUAL_DESIGN_MARKER)
    expect(html).toContain('role="presentation"')
    expect(html).toContain('<!--[if mso]>')
    // Button background on the cell works in Outlook.
    expect(html).toMatch(/<td align="center" bgcolor="#2563eb"/)
    // No layout CSS that email clients drop.
    expect(html).not.toMatch(/display:\s*(flex|grid)|position:\s*(absolute|fixed)|<link /)
    // Every image has alt text and explicit width.
    for (const img of html.match(/<img [^>]+>/g) ?? []) {
      expect(img).toMatch(/ alt="[^"]+"/)
      expect(img).toMatch(/ width="\d+"/)
    }
  })

  it('renders through the template engine with loops, conditions and escaping', () => {
    const html = renderTemplate(compiled.html, context)
    expect(html).toContain('ORD-&lt;1&gt;')
    expect(html).toContain('Shoes × 1')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; × 2')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Tracking follows soon.')
    expect(html).toContain('href="https://example.com/u/1"')

    const text = renderTemplate(compiled.text, {
      ...context,
      payload: { ...context.payload, items: [] },
    })
    expect(text).toContain('Hi Asha,')
    expect(text).toContain('No items')
    expect(text).toContain('Track order: https://example.com/t/1')
    expect(text).toContain('Unsubscribe: https://example.com/u/1')
  })

  it('applies the theme and lets design settings override it', () => {
    const themed = compileDesign(
      {
        version: 1,
        settings: { background: '#000000' },
        blocks: [{ id: 'b', type: 'button', label: 'Go', href: 'https://x' }],
      },
      {
        theme: {
          colors: { primary: '#ff0000', background: '#eeeeee' },
          logoUrl: 'https://x/logo.png',
          buttonRadius: 0,
        },
      },
    )
    expect(themed.html).toContain('bgcolor="#ff0000"')
    expect(themed.html).toContain('background-color:#000000')
    expect(themed.html).toContain('src="https://x/logo.png"')
    expect(themed.html).toContain('border-radius:0px')
  })

  it('ignores unsafe colour values', () => {
    const out = compileDesign({
      version: 1,
      blocks: [{ id: 't', type: 'text', text: 'x', color: 'red;background:url(x)' }],
    })
    expect(out.html).not.toContain('url(x)')
  })

  it('expands partials and reports missing or recursive ones', () => {
    const out = compileDesign(
      {
        version: 1,
        blocks: [
          { id: 'p1', type: 'partial', partialId: 'footer', version: 2 },
          { id: 'p2', type: 'partial', partialId: 'missing' },
          { id: 'p3', type: 'partial', partialId: 'loop' },
        ],
      },
      {
        partials: {
          'footer@2': [{ id: 'ft', type: 'footer', text: 'Footer v2' }],
          loop: [{ id: 'self', type: 'partial', partialId: 'loop' }],
        },
      },
    )
    expect(out.html).toContain('Footer v2')
    expect(out.warnings).toContain('partial "missing" was not found; it was left out')
    expect(out.warnings).toContain('partial "loop" includes itself; it was left out')
  })

  it('uses media URLs for image blocks', () => {
    const out = compileDesign(
      { version: 1, blocks: [{ id: 'i', type: 'image', mediaId: 7, alt: 'Hero' }] },
      { media: { '7': 'https://cdn.example.com/hero.png' } },
    )
    expect(out.html).toContain('src="https://cdn.example.com/hero.png"')
  })

  it('is not wrapped by emailLayout', async () => {
    const options = normalizePluginOptions({
      templates: { emailLayout: '<main>{{{ content }}}</main>' },
    })
    const finished = await finalizeForChannel(
      { html: compiled.html, body: '' } as never,
      'email',
      options,
    )
    expect(finished.html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(finished.html).not.toContain('<main>')
  })
})

describe('compileVisualEmail hook', () => {
  const options = normalizePluginOptions({})
  const run = (
    data: Record<string, unknown>,
    originalDoc?: Record<string, unknown>,
    rawHtml = false,
  ) =>
    compileVisualEmail(() => ({
      ...options,
      access: { ...options.access, rawHtml: () => rawHtml },
    }))({
      data,
      originalDoc,
      req: {} as never,
      collection: { slug: 'notification-templates' } as never,
      context: {},
      operation: 'update',
    } as never)

  it('generates htmlBody and textBody from the design on save', async () => {
    const out = (await run({
      email: { editor: 'visual', design: orderDesign, htmlBody: 'old' },
    })) as {
      email: { htmlBody: string; textBody: string }
    }
    expect(out.email.htmlBody).toContain(VISUAL_DESIGN_MARKER)
    expect(out.email.textBody).toContain('Track order: {{ payload.url }}')
  })

  it('leaves code-mode templates alone', async () => {
    const data = { email: { editor: 'code', design: orderDesign, htmlBody: '<p>hand</p>' } }
    expect(await run(data)).toEqual(data)
  })

  it('rejects invalid designs', async () => {
    await expect(
      run({
        email: {
          editor: 'visual',
          design: { version: 1, blocks: [{ id: 'i', type: 'image', alt: '' }] },
        },
      }),
    ).rejects.toThrow()
  })

  it('needs access.rawHtml to add or change raw HTML blocks', async () => {
    const design = { version: 1, blocks: [{ id: 'r', type: 'html', html: '<b>x</b>' }] }
    await expect(run({ email: { editor: 'visual', design } })).rejects.toThrow()
    await expect(
      run({ email: { editor: 'visual', design } }, undefined, true),
    ).resolves.toBeDefined()
    // Unchanged raw HTML from a privileged author may be kept by others.
    await expect(
      run({ email: { editor: 'visual', design } }, { email: { design } }),
    ).resolves.toBeDefined()
    expect(
      changesRawHtml(design, { version: 1, blocks: [{ id: 'r', type: 'html', html: '<i>' }] }),
    ).toBe(true)
  })
})
