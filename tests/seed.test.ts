import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { seedTemplatesFromRegistry } from '../src/templates/seed'

describe('seedTemplatesFromRegistry', () => {
  it('creates missing templates from the registry', async () => {
    const created: string[] = []
    const payload = {
      find: mock(async () => ({ docs: [] })),
      create: mock(async ({ data }: { data: { slug: string } }) => {
        created.push(data.slug)
        return { id: data.slug }
      }),
    }

    const result = await seedTemplatesFromRegistry({
      payload: payload as never,
      options: normalizePluginOptions({
        templates: {
          registry: {
            'custom.ping': {
              inapp: { title: 'Ping', body: 'Hello' },
            },
          },
        },
      }),
      registry: {
        'custom.ping': {
          inapp: { title: 'Ping', body: 'Hello' },
        },
      },
    })

    expect(result.created).toEqual(['custom.ping'])
    expect(result.skipped).toEqual([])
    expect(created).toEqual(['custom.ping'])
  })

  it('skips existing slugs (idempotent)', async () => {
    const create = mock(async () => ({}))
    const payload = {
      find: mock(async () => ({ docs: [{ id: '1', slug: 'order.paid' }] })),
      create,
    }

    const result = await seedTemplatesFromRegistry({
      payload: payload as never,
      options: normalizePluginOptions(),
      registry: {
        'order.paid': {
          email: { subject: 'x', body: 'y' },
        },
      },
    })

    expect(result.skipped).toEqual(['order.paid'])
    expect(result.created).toEqual([])
    expect(create).toHaveBeenCalledTimes(0)
  })
})
