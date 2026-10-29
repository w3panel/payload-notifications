import { describe, expect, it } from 'bun:test'
import { NotificationTemplatesCollection } from '../src/collections/NotificationTemplates'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import {
  publishTemplate,
  rollbackTemplate,
  templateLifecycleEndpoints,
} from '../src/templates/lifecycle'
import { resolveTemplate } from '../src/templates/resolve'
import { localeCandidates } from '../src/templates/versions'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
type Hook = (args: Doc) => Promise<unknown> | unknown

const options = normalizePluginOptions({
  channels: ['email'],
  templates: { defaultLocale: 'en' },
})

const templateDoc = (id: string, locale: string, subject: string, extra: Doc = {}) => ({
  id,
  slug: 'order.paid',
  locale,
  status: 'active',
  version: 1,
  channels: ['email'],
  email: { subject, textBody: `${subject} body` },
  ...extra,
})

describe('locales', () => {
  it('orders locale candidates', () => {
    expect(localeCandidates('hi_IN', 'en')).toEqual(['hi-in', 'hi', 'en', ''])
    expect(localeCandidates(undefined, 'en-GB')).toEqual(['en-gb', 'en', ''])
    expect(localeCandidates('fr')).toEqual(['fr', ''])
  })

  it('picks the recipient locale, then the default, then the no-locale template', async () => {
    const memory = createMemoryPayload({
      'notification-templates': [
        templateDoc('t-default', '', 'Default'),
        templateDoc('t-en', 'en', 'English'),
        templateDoc('t-hi', 'hi', 'Hindi', { channels: ['email', 'sms'], sms: { body: '' } }),
      ],
    })
    const resolve = (locale?: string, channel: 'email' | 'sms' = 'email') =>
      resolveTemplate({
        event: 'order.paid',
        channel,
        templateKey: 'order.paid',
        options,
        payload: memory.payload,
        locale,
      })

    expect((await resolve('hi-IN')).definition.subject).toBe('Hindi')
    expect((await resolve('hi-IN')).templateLocale).toBe('hi')
    expect((await resolve('fr')).definition.subject).toBe('English')
    expect((await resolve(undefined)).templateLocale).toBe('en')
    // The Hindi variant has no SMS content: falls through to the registry starter
    expect((await resolve('hi', 'sms')).definition.body).toContain('{{ payload.orderId }}')
  })

  it('uses localized code registry variants', async () => {
    const localized = normalizePluginOptions({
      templates: {
        localized: { hi: { 'order.paid': { email: { subject: 'भुगतान हो गया', body: 'x' } } } },
      },
    })
    const resolved = await resolveTemplate({
      event: 'order.paid',
      channel: 'email',
      templateKey: 'order.paid',
      options: localized,
      locale: 'hi-IN',
    })
    expect(resolved).toMatchObject({
      templateLocale: 'hi',
      definition: { subject: 'भुगतान हो गया' },
    })
  })
})

describe('template collection hooks', () => {
  const collection = NotificationTemplatesCollection({ getOptions: () => options })
  const [uniqueHook] = collection.hooks!.beforeValidate as unknown as Hook[]
  const [versionHook] = collection.hooks!.beforeChange as unknown as Hook[]

  it('keeps slugs unique per locale', async () => {
    const memory = createMemoryPayload({ 'notification-templates': [templateDoc('a', 'hi', 'x')] })
    const req = { payload: memory.payload }
    await expect(uniqueHook({ data: { slug: 'order.paid', locale: 'HI' }, req })).rejects.toThrow()
    expect(await uniqueHook({ data: { slug: 'order.paid', locale: '' }, req })).toBeDefined()
    expect(
      await uniqueHook({
        data: { slug: 'order.paid' },
        originalDoc: { id: 'a', locale: 'hi' },
        req,
      }),
    ).toBeDefined()
  })

  it('bumps the version on activation and flags edits to active templates', () => {
    expect(
      versionHook({
        data: { status: 'active' },
        originalDoc: { status: 'draft', version: 1 },
        context: {},
      }),
    ).toMatchObject({
      version: 2,
      hasUnpublishedChanges: false,
    })
    const active = templateDoc('a', '', 'Live')
    expect(
      versionHook({
        data: { email: { subject: 'Edited', textBody: 'b' } },
        originalDoc: active,
        context: {},
      }),
    ).toMatchObject({
      hasUnpublishedChanges: true,
    })
    expect(versionHook({ data: { name: 'Renamed' }, originalDoc: active, context: {} })).toEqual({
      name: 'Renamed',
    })
  })
})

describe('publishing and pinning', () => {
  it('renders the published snapshot, not later edits, and pins queued deliveries', async () => {
    const memory = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com' }],
      'notification-templates': [
        { ...templateDoc('t1', '', 'Version one'), status: 'draft', version: 0 },
      ],
    })
    const pluginOptions = normalizePluginOptions({
      channels: ['email'],
      triggers: [
        {
          slug: 'paid',
          event: 'order.paid',
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
      ],
    })
    expect(
      await publishTemplate({ payload: memory.payload, options: pluginOptions, id: 't1' }),
    ).toMatchObject({ ok: true, version: 1 })

    // Unpublished edit: not live
    memory.docs('notification-templates')[0].email = { subject: 'Draft edit', textBody: 'x' }
    const live = await resolveTemplate({
      event: 'order.paid',
      channel: 'email',
      templateKey: 'order.paid',
      options: pluginOptions,
      payload: memory.payload,
    })
    expect(live).toMatchObject({ templateVersion: 1, definition: { subject: 'Version one' } })

    // Plan a delivery (pins v1), then publish v2 before it is sent
    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'e1', userId: 'u1' },
      options: pluginOptions,
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      templateVersion: 1,
      templateLocale: '',
    })
    expect(
      await publishTemplate({ payload: memory.payload, options: pluginOptions, id: 't1' }),
    ).toMatchObject({ version: 2 })

    const job = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
    await sendNotification({
      payload: memory.payload,
      input: job.input as never,
      options: pluginOptions,
    })
    expect((memory.sendEmail.mock.calls[0][0] as unknown as Doc).subject).toBe('Version one')

    // Rollback to v1 publishes it as v3
    expect(
      await rollbackTemplate({
        payload: memory.payload,
        options: pluginOptions,
        id: 't1',
        version: 1,
      }),
    ).toMatchObject({ version: 3 })
    expect(memory.docs('notification-templates')[0]).toMatchObject({
      version: 3,
      email: { subject: 'Version one' },
    })
    expect(memory.docs('notification-template-versions').map((v) => v.version)).toEqual([1, 2, 3])
  })

  it('still renders active templates that predate snapshots', async () => {
    const memory = createMemoryPayload({
      'notification-templates': [templateDoc('legacy', '', 'Legacy')],
    })
    const resolved = await resolveTemplate({
      event: 'order.paid',
      channel: 'email',
      templateKey: 'order.paid',
      options,
      payload: memory.payload,
    })
    expect(resolved).toMatchObject({ templateVersion: 1, definition: { subject: 'Legacy' } })
  })

  it('guards the publish endpoint and reports validation failures', async () => {
    const memory = createMemoryPayload({ 'notification-templates': [templateDoc('t1', '', 'x')] })
    const restricted = normalizePluginOptions({ access: { publishTemplates: () => false } })
    const [publish] = templateLifecycleEndpoints(() => restricted)
    expect(
      (
        await publish.handler({
          user: { id: 'a' },
          routeParams: { id: 't1' },
          payload: memory.payload,
        } as never)
      ).status,
    ).toBe(403)

    const [validated] = templateLifecycleEndpoints(
      () => options,
      async () => ({ errors: ['broken'] }),
    )
    const res = await validated.handler({
      user: { id: 'a' },
      routeParams: { id: 't1' },
      payload: memory.payload,
    } as never)
    expect(res.status).toBe(422)
    expect((await res.json()).details).toEqual({ errors: ['broken'] })
  })
})

describe('template version numbering', () => {
  it('publishes a draft as version 1', async () => {
    const options = normalizePluginOptions()
    const collection = NotificationTemplatesCollection({ getOptions: () => options })
    const versionField = collection.fields.find(
      (field) => 'name' in field && field.name === 'version',
    ) as {
      defaultValue?: number
    }
    // New templates are unpublished (0); the first publish is version 1.
    expect(versionField.defaultValue).toBe(0)
    const memory = createMemoryPayload({
      'notification-templates': [
        {
          id: 't9',
          slug: 'draft.event',
          status: 'draft',
          version: 0,
          channels: ['inapp'],
          inapp: { title: 'T', body: 'B' },
        },
      ],
    })
    const result = await publishTemplate({ payload: memory.payload, options, id: 't9' })
    expect(result).toMatchObject({ ok: true, version: 1 })
  })
})

describe('template fields with the visual designer', () => {
  it('hides the generated HTML and text bodies while the designer is used', () => {
    const collection = NotificationTemplatesCollection({
      getOptions: () => normalizePluginOptions(),
    })
    const email = collection.fields.find((field) => 'name' in field && field.name === 'email') as {
      fields: Array<{
        name?: string
        admin?: { condition?: (data: unknown, sibling: unknown) => boolean }
      }>
    }
    for (const name of ['htmlBody', 'textBody']) {
      const condition = email.fields.find((field) => field.name === name)?.admin?.condition
      expect(condition?.({}, { editor: 'visual' })).toBe(false)
      expect(condition?.({}, { editor: 'code' })).toBe(true)
      expect(condition?.({}, {})).toBe(true)
    }
  })
})
