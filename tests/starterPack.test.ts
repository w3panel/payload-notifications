import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { compile } from '../src/templates/engine'
import { renderDefinition } from '../src/templates/renderDefinition'
import { contentHash, seedTemplatesFromRegistry } from '../src/templates/seed'
import { starterEvents, starterTemplates, starterTemplateSlugs } from '../src/templates/starterPack'
import {
  availableVariables,
  checkTemplateVariables,
  definitionSources,
} from '../src/templates/variables'
import type { NotificationTemplateDefinition } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

const asDefinition = (entry: string | NotificationTemplateDefinition | undefined) =>
  (typeof entry === 'string' ? { body: entry } : entry) as NotificationTemplateDefinition

describe('starter pack', () => {
  it('has 20 events across ecommerce, auth and saas', () => {
    expect(starterTemplateSlugs('ecommerce')).toHaveLength(7)
    expect(starterTemplateSlugs('auth')).toHaveLength(5)
    expect(starterTemplateSlugs('saas')).toHaveLength(8)
    expect(Object.keys(starterEvents())).toHaveLength(20)
    expect(Object.keys(starterTemplates(['auth']))).toEqual(starterTemplateSlugs('auth'))
  })

  it('every template compiles, uses only its sample payload, and renders', () => {
    const options = normalizePluginOptions({ templates: { starterPack: true } })
    for (const [slug, set] of Object.entries(starterTemplates())) {
      const sample = starterEvents()[slug].samplePayload
      for (const channel of ['email', 'sms', 'whatsapp', 'inapp'] as const) {
        const definition = asDefinition(set[channel])
        expect(definition, `${slug} ${channel}`).toBeDefined()
        const sources = definitionSources(definition)
        for (const source of sources) compile(source)
        expect(
          checkTemplateVariables(sources, availableVariables(options, { event: slug })).unknown,
          `${slug} ${channel}`,
        ).toEqual([])
        const rendered = renderDefinition(definition, {
          event: slug,
          userId: 'u1',
          payload: sample,
          recipient: { name: 'Alex' },
        })
        expect(rendered.body, `${slug} ${channel}`).not.toContain('{{')
      }
    }
  })

  it('renders formatters as expected', () => {
    const set = starterTemplates()['booking.confirmed']
    const rendered = renderDefinition(asDefinition(set.sms), {
      event: 'booking.confirmed',
      userId: 'u1',
      payload: starterEvents()['booking.confirmed'].samplePayload,
    })
    expect(rendered.body).toStartWith('Consultation booked for Nov 2')
  })

  it('merges into options with user registry and events taking precedence', () => {
    const options = normalizePluginOptions({
      templates: { starterPack: ['ecommerce'], registry: { 'order.paid': { email: 'mine' } } },
      events: { 'order.shipped': { label: 'Mine' } },
    })
    expect(options.templates.registry['order.paid']).toEqual({ email: 'mine' })
    expect(options.templates.registry['refund.processed']).toBeDefined()
    expect(options.templates.registry['auth.otp']).toBeUndefined()
    expect(options.events['order.shipped']).toEqual({ label: 'Mine' })
    expect(options.events['cart.abandoned'].classification).toBe('marketing')
  })
})

describe('seeding', () => {
  const options = normalizePluginOptions({ templates: { starterPack: ['auth'] } })
  const registry = starterTemplates(['auth'])

  it('creates seeded templates once and skips existing ones', async () => {
    const memory = createMemoryPayload()
    const first = await seedTemplatesFromRegistry({ payload: memory.payload, options, registry })
    expect(first.created).toHaveLength(5)
    const second = await seedTemplatesFromRegistry({ payload: memory.payload, options, registry })
    expect(second).toEqual({ created: [], skipped: starterTemplateSlugs('auth'), updated: [] })
    const otp = memory.docs('notification-templates').find((doc) => doc.slug === 'auth.otp')!
    expect(otp).toMatchObject({
      source: 'seed',
      status: 'active',
      channels: ['email', 'sms', 'whatsapp', 'inapp'],
    })
    expect(otp.seedHash).toBe(contentHash(otp))
  })

  it('refreshes unedited seeded templates but never admin edits', async () => {
    const memory = createMemoryPayload()
    await seedTemplatesFromRegistry({ payload: memory.payload, options, registry })
    const docs = memory.docs('notification-templates')
    // An admin edits the welcome email; the OTP template stays as seeded (with DB-style nulls).
    docs.find((doc) => doc.slug === 'user.welcome')!.email = {
      subject: 'Edited by admin',
      textBody: 'x',
    }
    const otp = docs.find((doc) => doc.slug === 'auth.otp')!
    otp.variables = []
    ;(otp.email as Record<string, unknown>).htmlBody = null

    const changed = Object.fromEntries(
      Object.entries(registry).map(([slug, set]) => [
        slug,
        { ...set, sms: `${String(set.sms)} (v2)` },
      ]),
    )
    const result = await seedTemplatesFromRegistry({
      payload: memory.payload,
      options,
      registry: changed,
      updateUnedited: true,
    })
    expect(result.updated).toContain('auth.otp')
    expect(result.skipped).toEqual(['user.welcome'])
    expect(docs.find((doc) => doc.slug === 'auth.otp')).toMatchObject({
      version: 2,
      sms: { body: expect.stringContaining('(v2)') },
    })
    expect(docs.find((doc) => doc.slug === 'user.welcome')!.email).toEqual({
      subject: 'Edited by admin',
      textBody: 'x',
    })
  })
})
