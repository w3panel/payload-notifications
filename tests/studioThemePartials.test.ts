import { describe, expect, it } from 'bun:test'
import {
  NotificationTemplatePartialsCollection,
  partialDesignAt,
} from '../src/collections/NotificationTemplatePartials'
import { NotificationThemeGlobal } from '../src/collections/NotificationTheme'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { loadDesignResources, themeFromGlobal } from '../src/studio/resources'
import { compileVisualEmail } from '../src/studio/save'
import { notificationsPlugin } from '../src/plugin'

const design = (text: string) => ({ version: 1, blocks: [{ id: 't', type: 'text', text }] })

describe('brand theme', () => {
  it('is registered as a global', () => {
    const config = notificationsPlugin()({ collections: [] })
    expect(config.globals?.map((global) => global.slug)).toEqual(['notification-theme'])
    // A host-defined global with the same slug wins.
    const own = notificationsPlugin()({
      collections: [],
      globals: [{ slug: 'notification-theme', fields: [] }],
    })
    expect(own.globals).toHaveLength(1)
    expect(own.globals?.[0].fields).toEqual([])
  })

  it('validates colours and converts to compiler options', () => {
    const global = NotificationThemeGlobal()
    expect(global.slug).toBe('notification-theme')
    expect(
      themeFromGlobal({
        logoUrl: 'https://x/logo.png',
        logoAlt: '',
        buttonRadius: 0,
        colors: { primary: '#ff0000', text: null },
        footerText: 'Acme',
      }),
    ).toEqual({
      logoUrl: 'https://x/logo.png',
      buttonRadius: 0,
      footerText: 'Acme',
      colors: { primary: '#ff0000' },
    })
    expect(themeFromGlobal(null)).toEqual({})
  })
})

describe('template partials', () => {
  const hook = NotificationTemplatePartialsCollection({
    getOptions: () => normalizePluginOptions({}),
  }).hooks!.beforeChange![0]
  const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
    hook({ data, originalDoc, req: { user: { id: 'u' } }, collection: { slug: 'p' } } as never)

  it('starts at version 1 and bumps the version with history on design changes', async () => {
    const created = (await run({ name: 'Footer', design: design('v1') })) as Record<string, unknown>
    expect(created.version).toBe(1)
    const original = { ...created, id: 'p1' }
    const updated = (await run({ design: design('v2') }, original)) as Record<string, unknown>
    expect(updated.version).toBe(2)
    expect(updated.history).toEqual([expect.objectContaining({ version: 1, design: design('v1') })])
    // Renaming does not create a version.
    expect(await run({ name: 'Footer 2' }, original)).toEqual({ name: 'Footer 2' })
  })

  it('rejects invalid designs and unpermitted raw HTML', async () => {
    await expect(
      run({ design: { version: 1, blocks: [{ id: 'i', type: 'image', alt: '' }] } }),
    ).rejects.toThrow()
    await expect(
      run({ design: { version: 1, blocks: [{ id: 'r', type: 'html', html: '<b>' }] } }),
    ).rejects.toThrow()
  })

  it('returns the design for a pinned version', () => {
    const doc = {
      version: 3,
      design: design('v3'),
      history: [
        { version: 2, design: design('v2') },
        { version: 1, design: design('v1') },
      ],
    }
    expect(partialDesignAt(doc)?.blocks[0]).toMatchObject({ text: 'v3' })
    expect(partialDesignAt(doc, 1)?.blocks[0]).toMatchObject({ text: 'v1' })
    expect(partialDesignAt(doc, 9)).toBeUndefined()
  })
})

describe('compiling with theme and partials', () => {
  const options = normalizePluginOptions({})
  const partialDocs: Record<string, Record<string, unknown>> = {
    header: {
      id: 'header',
      version: 2,
      design: {
        version: 1,
        blocks: [
          { id: 'h', type: 'heading', text: 'Header v2' },
          { id: 'n', type: 'partial', partialId: 'nested' },
        ],
      },
      history: [
        {
          version: 1,
          design: { version: 1, blocks: [{ id: 'h', type: 'heading', text: 'Header v1' }] },
        },
      ],
    },
    nested: { id: 'nested', version: 1, design: design('Nested section') },
  }
  const req = {
    user: { id: 'u' },
    payload: {
      findByID: async ({ id }: { id: string }) => {
        if (!partialDocs[id]) throw new Error('not found')
        return partialDocs[id]
      },
      findGlobal: async () => ({ colors: { primary: '#123456' }, footerText: 'Theme footer' }),
    },
  }

  it('loads the theme, pinned partials and nested partials', async () => {
    const resources = await loadDesignResources({
      design: {
        version: 1,
        blocks: [
          { id: 'p1', type: 'partial', partialId: 'header' },
          { id: 'p2', type: 'partial', partialId: 'header', version: 1 },
        ],
      },
      req: req as never,
      options,
    })
    expect(resources.theme?.colors?.primary).toBe('#123456')
    expect(Object.keys(resources.partials ?? {}).sort()).toEqual(['header', 'header@1', 'nested'])
  })

  it('compiles a template with them on save', async () => {
    const out = (await compileVisualEmail(
      () => options,
      loadDesignResources,
    )({
      data: {
        email: {
          editor: 'visual',
          design: {
            version: 1,
            blocks: [
              { id: 'p', type: 'partial', partialId: 'header' },
              { id: 'b', type: 'button', label: 'Go', href: 'https://x' },
              { id: 'f', type: 'footer', text: '' },
            ],
          },
        },
      },
      req,
      collection: { slug: 'notification-templates' },
    } as never)) as { email: { htmlBody: string } }
    expect(out.email.htmlBody).toContain('Header v2')
    expect(out.email.htmlBody).toContain('Nested section')
    expect(out.email.htmlBody).toContain('bgcolor="#123456"')
    expect(out.email.htmlBody).toContain('Theme footer')
  })

  it('recompiles the stored design when an update sends no email (publish)', async () => {
    const stored = { editor: 'visual', design: design('Stored'), htmlBody: 'stale' }
    const out = (await compileVisualEmail(() => options)({
      data: { status: 'active' },
      originalDoc: { email: stored },
      req: {},
      collection: { slug: 'notification-templates' },
    } as never)) as { email: { htmlBody: string } }
    expect(out.email.htmlBody).toContain('Stored')
  })
})
