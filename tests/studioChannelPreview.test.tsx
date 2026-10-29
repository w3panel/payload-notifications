import { describe, expect, it } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { ChannelPreview, segmentRemainder } from '../src/admin/studio/ChannelPreview'
import { templateChannels } from '../src/admin/studio/PreviewPanel'
import { smsSegments } from '../src/templates/channelContent'

/** Server-rendered HTML without React's text separators. */
const render = (node: Parameters<typeof renderToString>[0]) =>
  renderToString(node).replaceAll('<!-- -->', '')

describe('channel-native previews', () => {
  it('shows SMS in a phone with the segment counter', () => {
    const body = 'Your order ORD-1 has shipped. Track: https://x.co/t'
    const html = render(
      <ChannelPreview channel="sms" rendered={{ body, segments: smsSegments(body) }} />,
    )
    expect(html).toContain('pn-phone-sms')
    expect(html).toContain(body)
    expect(html).toContain('51 characters · GSM-7 · 1 segment')
    expect(html).toContain('109 left in this segment')
  })

  it('counts remaining characters for multi-part and Unicode SMS', () => {
    expect(segmentRemainder({ encoding: 'GSM-7', characters: 200, segments: 2 })).toBe(106)
    expect(segmentRemainder({ encoding: 'UCS-2', characters: 60, segments: 1 })).toBe(10)
    const html = render(
      <ChannelPreview channel="sms" rendered={{ body: 'नमस्ते', segments: smsSegments('नमस्ते') }} />,
    )
    expect(html).toContain('UCS-2')
    expect(html).toContain('cut each segment to 70 characters')
  })

  it('shows WhatsApp approved templates with their parameters', () => {
    const html = render(
      <ChannelPreview
        channel="whatsapp"
        rendered={{
          body: 'ignored',
          whatsappTemplate: {
            name: 'order_paid',
            language: 'en',
            parameters: ['Asha', 'ORD-1'],
            status: 'APPROVED',
          },
        }}
      />,
    )
    expect(html).toContain('order_paid')
    expect(html).toContain('APPROVED')
    expect(html).toContain('{{1}}</code> Asha')
    expect(html).not.toContain('ignored')
    expect(render(<ChannelPreview channel="whatsapp" rendered={{ body: 'Hello' }} />)).toContain(
      'pn-bubble-whatsapp">Hello',
    )
  })

  it('shows in-app notifications as a card', () => {
    const html = render(
      <ChannelPreview
        channel="inapp"
        rendered={{
          title: 'Order shipped',
          body: 'On its way',
          actionUrl: '/orders/1',
          icon: '📦',
          priority: 'high',
        }}
      />,
    )
    expect(html).toContain('pn-inapp-card')
    expect(html).toContain('Order shipped')
    expect(html).toContain('Opens /orders/1')
    expect(html).toContain('pn-badge-high')
  })

  it('previews the channels a template has', () => {
    expect(templateChannels({ channels: ['sms', 'email', 'push'] })).toEqual(['email', 'sms'])
    expect(templateChannels({})).toEqual([])
  })
})
