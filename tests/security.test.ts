import { describe, expect, it } from 'bun:test'
import type { Endpoint } from 'payload'
import { getPath, pickPaths } from '../src/data/paths'
import { validateDataSources } from '../src/data/sources'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { validateTemplateDoc } from '../src/templates/validate'
import { notificationsPlugin } from '../src/plugin'

/** Endpoints anyone may call: one-click unsubscribe (signed token) and provider webhooks (signatures). */
const PUBLIC = [/\/unsubscribe$/, /\/webhooks\//]

const allEndpoints = () => {
  const config = notificationsPlugin({
    eventsInbox: true,
    preferences: { mode: 'collection' },
  })({ collections: [{ slug: 'users', auth: true, fields: [] }] } as never)
  const root = (config.endpoints ?? []).map((endpoint) => ({ owner: 'root', endpoint }))
  const collections = (config.collections ?? []).flatMap((collection) =>
    ((collection.endpoints || []) as Endpoint[]).map((endpoint) => ({
      owner: collection.slug,
      endpoint,
    })),
  )
  return [...root, ...collections]
}

describe('security review regressions', () => {
  it('refuses every non-public endpoint without a signed-in user', async () => {
    const endpoints = allEndpoints().filter(
      ({ endpoint }) => !PUBLIC.some((pattern) => pattern.test(endpoint.path)),
    )
    expect(endpoints.length).toBeGreaterThanOrEqual(20)
    for (const { owner, endpoint } of endpoints) {
      const res = await endpoint.handler({
        user: null,
        url: `http://x/api${endpoint.path}`,
        routeParams: { id: '1', slug: 'x', channel: 'email' },
        json: async () => ({}),
        payload: {},
      } as never)
      const refused = res.status === 401 || res.status === 403
      expect(
        `${owner} ${endpoint.method} ${endpoint.path} → ${refused ? 'refused' : res.status}`,
      ).toBe(`${owner} ${endpoint.method} ${endpoint.path} → refused`)
    }
  })

  it('does not follow prototype keys in paths (no prototype pollution)', () => {
    const payload = JSON.parse('{"__proto__": {"polluted": "yes"}, "a": {"constructor": {"x": 1}}}')
    expect(getPath(payload, '__proto__.polluted')).toBeUndefined()
    const picked = pickPaths(payload, ['__proto__.polluted', 'a.constructor.x'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(picked).toEqual({})
  })

  it('rejects data source fields with prototype keys', () => {
    const errors = validateDataSources(
      [{ type: 'event', alias: 'evt', fields: ['__proto__.polluted'] }],
      { allowlist: {}, isSensitive: () => false, owner: 'trigger "t"' },
    )
    expect(errors.join(' ')).toContain('"__proto__.polluted" is not allowed (prototype keys)')
  })

  it('warns about unescaped {{{ }}} output in templates', async () => {
    const report = await validateTemplateDoc({} as never, normalizePluginOptions(), {
      slug: 'x',
      channels: ['email'],
      email: { subject: 'Hi', htmlBody: '<p>{{{ payload.bio }}}</p>' },
    })
    expect(report.warnings).toContain(
      '"{{{ payload.bio }}}" inserts the value without HTML escaping; use it only for trusted HTML',
    )
  })

  it('keeps raw HTML blocks closed by default', async () => {
    expect(
      await normalizePluginOptions().access.rawHtml({ req: { user: { id: 'admin' } } } as never),
    ).toBe(false)
  })
})
