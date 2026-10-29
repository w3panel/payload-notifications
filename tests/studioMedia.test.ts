import { describe, expect, it } from 'bun:test'
import { NotificationThemeGlobal } from '../src/collections/NotificationTheme'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { absoluteUrl, loadDesignResources, loadMedia } from '../src/studio/resources'
import { compileVisualEmail, imageProblems } from '../src/studio/save'

const options = normalizePluginOptions({ templates: { mediaCollection: 'media' } })
const mediaDocs: Record<string, Record<string, unknown>> = {
  '1': { id: 1, url: '/api/media/file/hero.png', alt: 'Hero' },
  '2': { id: 2, url: 'https://cdn.example.com/two.png' },
}
const req = (serverURL?: string) => ({
  user: { id: 'u' },
  payload: {
    config: { serverURL },
    findByID: async ({ collection, id }: { collection: string; id: string }) => {
      if (collection !== 'media' || !mediaDocs[id]) throw new Error('not found')
      return mediaDocs[id]
    },
    findGlobal: async () => ({
      logo: { url: '/api/media/file/logo.png' },
      logoUrl: 'https://old/logo.png',
    }),
  },
})

describe('media in visual designs', () => {
  it('makes media URLs absolute', () => {
    expect(absoluteUrl('https://x/a.png')).toBe('https://x/a.png')
    expect(absoluteUrl('//cdn.x/a.png')).toBe('https://cdn.x/a.png')
    expect(absoluteUrl('/api/media/a.png', 'https://shop.example.com/')).toBe(
      'https://shop.example.com/api/media/a.png',
    )
    expect(absoluteUrl('/api/media/a.png')).toBeUndefined()
    expect(absoluteUrl('relative.png', 'https://x')).toBeUndefined()
  })

  it('loads image URLs from the media collection', async () => {
    const media = await loadMedia(req('https://shop.example.com') as never, options, [
      [
        { id: 'a', type: 'image', mediaId: 1, alt: 'Hero' },
        {
          id: 's',
          type: 'section',
          children: [{ id: 'b', type: 'image', mediaId: 2, alt: 'Two' }],
        },
        { id: 'c', type: 'image', mediaId: 404, alt: 'Missing' },
      ],
    ])
    expect(media).toEqual({
      '1': 'https://shop.example.com/api/media/file/hero.png',
      '2': 'https://cdn.example.com/two.png',
    })
    expect(await loadMedia(req() as never, normalizePluginOptions({}), [[]])).toEqual({})
  })

  it('uses an uploaded theme logo', async () => {
    const resources = await loadDesignResources({
      design: { version: 1, blocks: [] },
      req: req('https://shop.example.com') as never,
      options,
    })
    expect(resources.theme?.logoUrl).toBe('https://shop.example.com/api/media/file/logo.png')
  })

  it('requires alt text and absolute image URLs', () => {
    expect(
      imageProblems(
        {
          version: 1,
          blocks: [
            { id: 'a', type: 'image', src: '/relative.png', alt: 'Rel' },
            { id: 'b', type: 'image', src: '{{ payload.imageUrl }}', alt: 'Dynamic' },
            { id: 'c', type: 'image', mediaId: 9, alt: 'Media' },
            { id: 'd', type: 'image', src: 'https://x/a.png', alt: ' ' },
          ],
        },
        { partials: { p1: [{ id: 'e', type: 'image', src: 'x.png', alt: 'In partial' }] } },
      ),
    ).toEqual([
      'image "Rel": the image URL must be absolute (https://…)',
      'image "Media": media 9 has no absolute URL (set serverURL or templates.mediaBaseUrl)',
      'image d: alt text is required',
      'partial p1: image "In partial": the image URL must be absolute (https://…)',
    ])
  })

  it('blocks saving a template whose media has no absolute URL', async () => {
    const hook = compileVisualEmail(() => options, loadDesignResources)
    const save = (serverURL?: string) =>
      hook({
        data: {
          email: {
            editor: 'visual',
            design: { version: 1, blocks: [{ id: 'a', type: 'image', mediaId: 1, alt: 'Hero' }] },
          },
        },
        req: req(serverURL),
        collection: { slug: 'notification-templates' },
      } as never)
    await expect(save()).rejects.toThrow()
    const ok = (await save('https://shop.example.com')) as { email: { htmlBody: string } }
    expect(ok.email.htmlBody).toContain('src="https://shop.example.com/api/media/file/hero.png"')
  })

  it('adds a logo upload to the theme when a media collection is set', () => {
    const fieldNames = (global: ReturnType<typeof NotificationThemeGlobal>) =>
      JSON.stringify(global.fields).match(/"name":"logo"/g)?.length ?? 0
    expect(fieldNames(NotificationThemeGlobal({ getOptions: () => options }))).toBe(1)
    expect(
      fieldNames(NotificationThemeGlobal({ getOptions: () => normalizePluginOptions({}) })),
    ).toBe(0)
  })
})
