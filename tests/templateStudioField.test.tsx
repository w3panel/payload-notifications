import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'

import rolldownConfig from '../rolldown.config.js'

const getData = mock(() => ({ slug: 'order.paid' }))

const fields: Record<string, unknown> = {}

mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData }),
  useField: ({ path }: { path: string }) => ({ value: fields[path], setValue: () => {} }),
  useDocumentInfo: () => ({ id: fields.id }),
  useFormModified: () => false,
}))

describe('TemplateStudioField', () => {
  it('renders inside a Payload form without reading form data up front', async () => {
    const { TemplateStudioField } = await import('../src/admin/TemplateStudioField')

    const html = renderToString(<TemplateStudioField path="templateStudio" />)

    expect(html).toContain('Template studio')
    expect(html).not.toContain('class="pn-designer"')
    expect(getData).not.toHaveBeenCalled()
  })

  it('shows the visual designer when the email editor is visual', async () => {
    const { TemplateStudioField } = await import('../src/admin/TemplateStudioField')
    fields['email.editor'] = 'visual'
    fields['email.design'] = {
      version: 1,
      blocks: [
        { id: 'h', type: 'heading', text: 'Order **{{ payload.orderId }}**' },
        {
          id: 'l',
          type: 'loop',
          path: 'payload.items',
          children: [{ id: 't', type: 'text', text: '<b>{{ name }}</b>' }],
        },
      ],
    }
    const html = renderToString(<TemplateStudioField path="templateStudio" />)
    delete fields['email.editor']
    expect(html).toContain('class="pn-designer"')
    expect(html).toContain('<span class="pn-var" title="Variable">payload.orderId</span>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('Repeat for each')
    // Raw HTML is hidden from the palette without the permission.
    expect(html).not.toContain('>Raw HTML<')
  })

  it('keeps the admin bundle a client module', () => {
    const adminBuild = rolldownConfig.find(
      (entry) => typeof entry.input === 'object' && 'admin/index' in entry.input,
    )

    expect(adminBuild?.output?.banner).toBe("'use client'")
  })
})
