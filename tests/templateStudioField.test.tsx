import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'

import rolldownConfig from '../rolldown.config.js'

const getData = mock(() => ({ slug: 'order.paid' }))

mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData }),
}))

describe('TemplateStudioField', () => {
  it('renders inside a Payload form without reading form data up front', async () => {
    const { TemplateStudioField } = await import('../src/admin/TemplateStudioField')

    const html = renderToString(<TemplateStudioField path="templateStudio" />)

    expect(html).toContain('Template studio')
    expect(getData).not.toHaveBeenCalled()
  })

  it('keeps the admin bundle a client module', () => {
    const adminBuild = rolldownConfig.find(
      (entry) => typeof entry.input === 'object' && 'admin/index' in entry.input,
    )

    expect(adminBuild?.output?.banner).toBe("'use client'")
  })
})
