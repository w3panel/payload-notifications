import { describe, expect, it } from 'bun:test'
import {
  BLOCK_TYPES,
  createBlock,
  DESIGN_VERSION,
  migrateDesign,
  parseDesign,
  walkBlocks,
  type EmailDesign,
} from '../src/studio/model'
import { validateEmailDesign } from '../src/collections/NotificationTemplates'

const fullDesign = (): EmailDesign => ({
  version: DESIGN_VERSION,
  settings: { width: 640, background: '#f4f4f5', fontFamily: 'Arial, sans-serif' },
  blocks: [
    {
      id: 'sec',
      type: 'section',
      padding: 24,
      background: '#ffffff',
      children: [
        { id: 'h', type: 'heading', text: 'Order **{{ payload.orderId }}**', level: 1 },
        { id: 't', type: 'text', text: 'Hi {{ recipient.name }}, thanks!', align: 'left' },
        {
          id: 'cols',
          type: 'columns',
          columns: [
            {
              width: 40,
              children: [{ id: 'img', type: 'image', src: 'https://cdn.x/a.png', alt: 'Logo' }],
            },
            {
              children: [{ id: 'btn', type: 'button', label: 'Track', href: '{{ payload.url }}' }],
            },
          ],
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
          children: [{ id: 'ct', type: 'text', text: 'Tracking: {{ payload.trackingNumber }}' }],
          elseChildren: [{ id: 'ce', type: 'text', text: 'We will email tracking soon.' }],
        },
        { id: 'd', type: 'divider', color: '#e4e4e7' },
        { id: 's', type: 'spacer', height: 16 },
        { id: 'l', type: 'list', items: ['One', 'Two'], ordered: true },
        { id: 'soc', type: 'social', links: [{ network: 'x', url: 'https://x.com/acme' }] },
        { id: 'p', type: 'partial', partialId: 'footer-1', version: 2 },
        { id: 'raw', type: 'html', html: '<b>raw</b>' },
        { id: 'f', type: 'footer', text: 'Acme Inc.', includeUnsubscribe: true },
      ],
    },
  ],
})

describe('email design model', () => {
  it('round-trips through JSON (save → load) without loss', () => {
    const design = fullDesign()
    const stored = JSON.parse(JSON.stringify(design))
    const parsed = parseDesign(stored)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.design).toEqual(design)
  })

  it('keeps fields it does not know about', () => {
    const design = { ...fullDesign(), meta: { createdWith: 'studio' } }
    const parsed = parseDesign(JSON.parse(JSON.stringify(design)))
    expect(parsed.ok && (parsed.design as unknown as { meta: unknown }).meta).toEqual({
      createdWith: 'studio',
    })
  })

  it('migrates version 0 designs (no ids, nested `blocks`, root settings)', () => {
    const legacy = {
      width: 560,
      blocks: [
        { type: 'section', blocks: [{ type: 'text', text: 'Hello' }] },
        { type: 'spacer', height: 10 },
      ],
    }
    const migrated = migrateDesign(legacy)
    expect(migrated.version).toBe(1)
    expect(migrated.settings).toEqual({ width: 560 })
    const parsed = parseDesign(legacy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const section = parsed.design.blocks[0] as { children: Array<{ id: string; text: string }> }
    expect(section.children[0].text).toBe('Hello')
    expect(section.children[0].id).toMatch(/^b_/)
  })

  it('rejects designs from a newer plugin version', () => {
    const result = parseDesign({ version: DESIGN_VERSION + 1, blocks: [] })
    expect(result.ok).toBe(false)
  })

  it('reports invalid blocks with their location', () => {
    const result = parseDesign({
      version: 1,
      blocks: [
        { id: 'a', type: 'image', src: 'https://x/a.png', alt: '' },
        { id: 'b', type: 'loop', path: 'bad path', children: [] },
        { id: 'c', type: 'nope' },
        { id: 'a', type: 'spacer', height: 4 },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain('blocks[0] (image): alt text is required')
    expect(result.errors.some((error) => error.includes('"bad path" is not a variable path'))).toBe(
      true,
    )
    expect(result.errors).toContain('blocks[2]: unknown block type "nope"')
  })

  it('detects duplicate block ids', () => {
    const result = parseDesign({
      version: 1,
      blocks: [
        { id: 'x', type: 'spacer', height: 4 },
        { id: 'x', type: 'divider' },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('creates every block type with defaults and unique ids', () => {
    const blocks = BLOCK_TYPES.map(createBlock)
    expect(new Set(blocks.map((block) => block.id)).size).toBe(BLOCK_TYPES.length)
    const ready = blocks.filter(
      (block) => !['image', 'partial', 'conditional'].includes(block.type),
    )
    expect(parseDesign({ version: 1, blocks: ready }).ok).toBe(true)
  })

  it('walks nested blocks depth-first', () => {
    const ids: string[] = []
    walkBlocks(fullDesign().blocks, (block) => ids.push(block.id))
    expect(ids.slice(0, 5)).toEqual(['sec', 'h', 't', 'cols', 'img'])
    expect(ids).toContain('ce')
  })

  it('validates the email.design field', () => {
    expect(validateEmailDesign(undefined)).toBe(true)
    expect(validateEmailDesign(fullDesign())).toBe(true)
    expect(
      validateEmailDesign({ version: 1, blocks: [{ id: 'i', type: 'image', alt: '' }] }),
    ).toMatch(/alt text is required/)
  })
})
