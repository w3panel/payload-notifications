import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import {
  providerStatus,
  settingsEndpoints,
  settingsSnapshot,
  testProviderConnection,
} from '../src/admin-ops/settings'

mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData: () => ({}) }),
  useField: () => ({ value: undefined, setValue: () => {} }),
  useDocumentInfo: () => ({}),
  useFormModified: () => false,
}))
const { SettingsBody } = await import('../src/admin/ProvidersSettings')

const SECRET = 'super-secret-token'
const options = normalizePluginOptions({
  channels: ['email', 'sms', 'whatsapp', 'inapp'],
  providers: {
    sms: { provider: 'twilio', accountSid: 'AC123', authToken: SECRET, from: '+15550000000' },
    whatsapp: { provider: 'meta', accessToken: SECRET, phoneNumberId: '1055' },
  },
  webhooks: {
    publicUrl: 'https://shop.example.com',
    meta: { appSecret: SECRET, verifyToken: 'v' },
  },
  maintenance: { reconcileCron: '*/15 * * * *' },
})
// Startup validation requires it; removed here to test the status report.
options.providers.sms!.from = ''

describe('providers and settings', () => {
  it('reports provider status and missing credentials without secret values', () => {
    const sms = providerStatus('sms', options)
    expect(sms).toMatchObject({ provider: 'twilio', source: 'builtin' })
    expect(sms.credentials).toEqual([
      { name: 'providers.sms.accountSid', set: true },
      { name: 'providers.sms.authToken', set: true },
      { name: 'providers.sms.from', set: false },
    ])
    expect(sms.problems).toEqual(['providers.sms.from is not set'])
    expect(providerStatus('whatsapp', options).webhookUrl).toBe(
      'https://shop.example.com/api/payload-notifications/webhooks/meta',
    )
    const snapshot = settingsSnapshot(options)
    expect(JSON.stringify(snapshot)).not.toContain(SECRET)
    expect(snapshot.webhooks).toEqual({
      baseUrl: 'https://shop.example.com/api/payload-notifications/webhooks',
      twilioSignature: false,
      metaSignature: true,
    })
    expect(snapshot.maintenance.reconcileCron).toBe('*/15 * * * *')
    const unconfigured = normalizePluginOptions({ channels: ['email'] })
    expect(providerStatus('sms', unconfigured).problems).toEqual([
      'No provider configured for sms (providers.sms)',
    ])
  })

  it('tests connections without sending messages', async () => {
    const fetcher = mock(async (url: string) =>
      Response.json(
        url.includes('graph.facebook.com')
          ? {
              display_phone_number: '+91 98765 43210',
              verified_name: 'HappenCare',
              quality_rating: 'GREEN',
            }
          : { error: { message: 'Authenticate' } },
        { status: url.includes('graph.facebook.com') ? 200 : 401 },
      ),
    )
    const meta = await testProviderConnection('whatsapp', options, {} as never, fetcher as never)
    expect(meta).toEqual({
      ok: true,
      message: 'WhatsApp number +91 98765 43210 (HappenCare, quality GREEN)',
    })
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { method?: string; headers: Record<string, string> },
    ]
    expect(url).toContain('/1055?fields=')
    expect(init.method).toBeUndefined()
    // Missing credentials fail before calling the provider.
    expect(await testProviderConnection('sms', options, {} as never, fetcher as never)).toEqual({
      ok: false,
      message: 'providers.sms.from is not set',
    })
    const twilio = normalizePluginOptions({
      channels: ['sms'],
      providers: { sms: { provider: 'twilio', accountSid: 'AC1', authToken: 't', from: '+1' } },
    })
    expect(await testProviderConnection('sms', twilio, {} as never, fetcher as never)).toEqual({
      ok: false,
      message: '401 Authenticate',
    })
  })

  it('checks the email adapter and custom provider tests', async () => {
    expect(
      await testProviderConnection('email', options, { email: { name: 'console' } } as never),
    ).toMatchObject({ ok: false })
    expect(
      await testProviderConnection('email', options, { email: { name: 'resend' } } as never),
    ).toEqual({
      ok: true,
      message: 'Payload email adapter "resend" is configured',
    })
    const custom = normalizePluginOptions({
      channels: ['sms'],
      providers: {
        custom: {
          sms: {
            name: 'msg91',
            channels: ['sms'],
            capabilities: { html: false, hsm: false, media: false },
            send: async () => ({ status: 'sent' }),
            testConnection: async () => ({ ok: true, message: 'MSG91 balance 120' }),
          },
        },
      },
    })
    expect(await testProviderConnection('sms', custom, {} as never)).toEqual({
      ok: true,
      message: 'MSG91 balance 120',
    })
  })

  it('guards the endpoints', async () => {
    const [settings, test] = settingsEndpoints(() =>
      normalizePluginOptions({ access: { viewDeliveries: () => false, testSend: () => false } }),
    )
    const req = {
      user: { id: 'a' },
      routeParams: { channel: 'email' },
      payload: { config: {} },
    } as never
    expect((await settings.handler(req)).status).toBe(403)
    expect((await test.handler(req)).status).toBe(403)
  })

  it('renders provider cards and settings', () => {
    const html = renderToString(
      <SettingsBody
        settings={settingsSnapshot(options)}
        onTest={() => {}}
        results={{ whatsapp: { ok: true, message: 'WhatsApp number +91' } }}
      />,
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('sms · twilio')
    expect(html).toContain('✗ providers.sms.from')
    expect(html).toContain('✓ WhatsApp number +91')
    expect(html).toContain('*/15 * * * *')
    expect(html).not.toContain(SECRET)
  })
})
