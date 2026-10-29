import { describe, expect, it } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { collapseDiff, diffLines, diffTemplateContent, formatHtmlForDiff } from '../src/studio/diff'
import { draftContent, versionPreviewDoc, VersionsPanel } from '../src/admin/studio/VersionsPanel'

describe('version diffs', () => {
  it('diffs lines with the longest common subsequence', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
    ])
    expect(diffLines('', 'new')).toEqual([{ type: 'added', text: 'new' }])
  })

  it('splits compiled HTML into one tag per line', () => {
    expect(formatHtmlForDiff('<table><tr><td>Hi</td></tr></table>')).toBe(
      '<table>\n<tr>\n<td>Hi</td>\n</tr>\n</table>',
    )
  })

  it('reports changed template fields only', () => {
    const before = {
      channels: ['email', 'sms'],
      email: { subject: 'Order {{ payload.orderId }}', htmlBody: '<p>Hi</p><p>Old</p>' },
      sms: { body: 'Same' },
      whatsapp: { hsmParameters: [{ value: 'a' }] },
    }
    const after = {
      channels: ['email', 'sms'],
      email: { subject: 'Your order {{ payload.orderId }}', htmlBody: '<p>Hi</p><p>New</p>' },
      sms: { body: 'Same' },
      whatsapp: { hsmParameters: [{ value: 'b' }] },
    }
    const diffs = diffTemplateContent(before, after)
    expect(diffs.map((diff) => diff.label)).toEqual([
      'Email subject',
      'Email HTML',
      'WhatsApp parameters',
    ])
    expect(diffs[1].lines).toEqual([
      { type: 'same', text: '<p>Hi</p>' },
      { type: 'removed', text: '<p>Old</p>' },
      { type: 'added', text: '<p>New</p>' },
    ])
    expect(diffs[2].lines).toEqual([
      { type: 'removed', text: '{{1}} a' },
      { type: 'added', text: '{{1}} b' },
    ])
  })

  it('collapses long unchanged runs', () => {
    const lines = diffLines('1\n2\n3\n4\n5\n6\n7', '1\n2\n3\n4\n5\n6\nX')
    expect(collapseDiff(lines, 1)).toEqual([
      { type: 'gap', count: 5 },
      { type: 'same', text: '6' },
      { type: 'removed', text: '7' },
      { type: 'added', text: 'X' },
    ])
  })
})

describe('versions panel', () => {
  it('builds draft content and version preview docs', () => {
    expect(
      draftContent({ name: 'x', slug: 's', channels: ['email'], email: { subject: 'S' } }),
    ).toEqual({
      channels: ['email'],
      email: { subject: 'S' },
      sms: undefined,
      whatsapp: undefined,
      inapp: undefined,
      variables: undefined,
    })
    // Old versions render their stored HTML, not a recompiled design.
    expect(
      versionPreviewDoc('order.paid', { email: { editor: 'visual', htmlBody: '<p>v1</p>' } }),
    ).toEqual({
      slug: 'order.paid',
      email: { editor: 'code', htmlBody: '<p>v1</p>' },
    })
  })

  const render = (props: Partial<Parameters<typeof VersionsPanel>[0]>) =>
    renderToString(
      <VersionsPanel
        apiRoute="/api"
        collectionSlug="notification-templates"
        versionsSlug="notification-template-versions"
        getDoc={() => ({})}
        {...props}
      />,
    ).replaceAll('<!-- -->', '')

  it('asks to save new templates first', () => {
    expect(render({})).toContain('Save the template to publish it')
  })

  it('shows the published version and blocks publishing unsaved edits', () => {
    const html = render({
      id: 't1',
      status: 'active',
      version: 3,
      hasUnpublishedChanges: true,
      modified: true,
    })
    expect(html).toContain('Published version 3 · unpublished changes')
    expect(html).toContain('Save your changes before publishing.')
    expect(html).toMatch(
      /<button type="button" disabled="" title="Save your changes first">Publish<\/button>/,
    )
  })
})
