import { describe, expect, it } from 'bun:test'
import { renderTemplate } from '../src/templates/engine'
import { renderDefinition } from '../src/templates/renderDefinition'

const context = {
  event: 'order.confirmed',
  payload: {
    codAmount: 'AED 10.00',
    note: 'Tom & Jerry <3',
    items: [
      { title: 'Whey', quantity: 2 },
      { title: 'Creatine', quantity: 1 },
    ],
  },
} as never

describe('plain-text rendering keeps block helpers', () => {
  it('renders #if, else and #each in text bodies, subjects and titles', () => {
    const out = renderDefinition(
      {
        subject: '{{#if payload.codAmount}}Pay {{ payload.codAmount }}{{else}}Paid{{/if}}',
        title: '{{#if payload.missing}}x{{else}}No missing{{/if}}',
        body: '{{#each payload.items}}- {{ title }} × {{ quantity }}\n{{/each}}{{ payload.note }}',
      },
      context,
    )
    expect(out.subject).toBe('Pay AED 10.00')
    expect(out.title).toBe('No missing')
    expect(out.body).toBe('- Whey × 2\n- Creatine × 1\nTom & Jerry <3')
  })
})

describe('template security checks expressions only', () => {
  it('allows ordinary copy that contains guarded words', () => {
    expect(renderTemplate('A new order is ready', {})).toBe('A new order is ready')
  })

  it('still rejects guarded words inside expressions', () => {
    expect(() => renderTemplate('{{ payload.constructor }}', {})).toThrow('security')
    expect(() => renderTemplate('{{{ new Thing }}}', {})).toThrow('security')
  })
})
