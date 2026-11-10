import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { clearTemplateCache, resolveTemplate } from '../src/templates/resolve'
import { loadTemplateSnapshot } from '../src/templates/versions'

const doc = {
  id: 't1',
  slug: 'order.confirmed',
  status: 'active',
  email: { subject: 'Hi', htmlBody: '<p>Hi</p>' },
}

const fakePayload = () => {
  const find = mock(async (args: { collection: string }) =>
    args.collection === 'notification-templates'
      ? { docs: [doc] }
      : { docs: [{ id: 's1', version: 2, content: doc }] },
  )
  return { payload: { find } as never, find }
}

const resolve = (payload: never, cacheTtlMs: number) =>
  resolveTemplate({
    event: 'order.confirmed',
    channel: 'email',
    templateKey: 'order.confirmed',
    options: normalizePluginOptions({ templates: { cacheTtlMs } }),
    payload,
  })

describe('template lookup cache', () => {
  it('queries every time when off', async () => {
    const { payload, find } = fakePayload()
    await resolve(payload, 0)
    await resolve(payload, 0)
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('reuses lookups within the TTL and after clearing queries again', async () => {
    const { payload, find } = fakePayload()
    await resolve(payload, 60_000)
    await resolve(payload, 60_000)
    expect(find).toHaveBeenCalledTimes(1)
    clearTemplateCache(payload as object)
    await resolve(payload, 60_000)
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('caches immutable snapshots per instance', async () => {
    const { payload, find } = fakePayload()
    const options = normalizePluginOptions({})
    await loadTemplateSnapshot(payload, options, 't1', 2)
    await loadTemplateSnapshot(payload, options, 't1', 2)
    expect(find).toHaveBeenCalledTimes(1)
    const other = fakePayload()
    await loadTemplateSnapshot(other.payload, options, 't1', 2)
    expect(other.find).toHaveBeenCalledTimes(1)
  })
})
