import { describe, expect, it } from 'bun:test'
import {
  applySuggestion,
  autocompleteQuery,
  designVariableIssues,
  expressionPath,
  isProvided,
  suggestVariables,
} from '../src/studio/variables'
import { wrapSelection } from '../src/admin/studio/InlineTextEditor'
import type { EmailDesign } from '../src/studio/model'

const roots = {
  event: null,
  payload: ['orderId', 'items', 'url'],
  recipient: ['name', 'email'],
  unsubscribeUrl: null,
}

describe('designer variables', () => {
  it('reads the path from expressions with formatters and defaults', () => {
    expect(expressionPath('payload.orderId')).toBe('payload.orderId')
    expect(expressionPath('date payload.createdAt "MMM d"')).toBe('payload.createdAt')
    expect(expressionPath('recipient.name | default "there"')).toBe('recipient.name')
  })

  it('checks paths against the roots, treating loop item fields as provided', () => {
    expect(isProvided('payload.orderId', roots)).toBe(true)
    expect(isProvided('payload.total', roots)).toBe(false)
    expect(isProvided('order.total', roots)).toBe(false)
    expect(isProvided('name', roots, ['payload.items'])).toBe(true)
    expect(isProvided('this.price', roots, ['payload.items'])).toBe(true)
    expect(isProvided('this.price', roots)).toBe(false)
  })

  it('reports unknown variables per block', () => {
    const design: EmailDesign = {
      version: 1,
      blocks: [
        { id: 'ok', type: 'text', text: 'Hi {{ recipient.name }}' },
        { id: 'bad', type: 'text', text: '{{ payload.total }} and {{ payload.total }}' },
        { id: 'btn', type: 'button', label: 'Go', href: '{{ order.url }}' },
        {
          id: 'loop',
          type: 'loop',
          path: 'payload.items',
          children: [{ id: 'item', type: 'text', text: '{{ name }} {{ payload.missing }}' }],
        },
        { id: 'cond', type: 'conditional', path: 'payload.tracking', children: [] },
      ],
    }
    const issues = designVariableIssues(design, roots)
    expect(issues.ok).toBeUndefined()
    expect(issues.bad).toEqual([
      {
        message: '"payload.total" is not provided by the selected event',
        path: 'payload.total',
        expression: 'payload.total',
      },
    ])
    expect(issues.btn[0].path).toBe('order.url')
    expect(issues.item.map((issue) => issue.path)).toEqual(['payload.missing'])
    expect(issues.cond[0].path).toBe('payload.tracking')
  })

  it('finds the {{ query at the caret', () => {
    expect(autocompleteQuery('Hi {{ pay', 9)).toEqual({ start: 3, query: 'pay' })
    expect(autocompleteQuery('Hi {{pay', 8)).toEqual({ start: 3, query: 'pay' })
    expect(autocompleteQuery('Hi {{ a }} b', 12)).toBeNull()
    expect(autocompleteQuery('no braces', 5)).toBeNull()
  })

  it('inserts the chosen variable and closes the braces', () => {
    expect(applySuggestion('Hi {{ pay', 9, 3, 'payload.orderId')).toEqual({
      value: 'Hi {{ payload.orderId }}',
      caret: 24,
    })
    expect(applySuggestion('Hi {{ pay }}!', 9, 3, 'payload.url').value).toBe(
      'Hi {{ payload.url }}!',
    )
  })

  it('ranks suggestions by prefix, then substring', () => {
    expect(suggestVariables(['recipient.name', 'payload.name', 'name.x'], 'name')).toEqual([
      'name.x',
      'recipient.name',
      'payload.name',
    ])
  })

  it('wraps the selection with inline markup', () => {
    expect(wrapSelection('make bold here', 5, 9, '**', '**')).toEqual({
      value: 'make **bold** here',
      start: 7,
      end: 11,
    })
    expect(wrapSelection('x', 1, 1, '_', '_', 'italic').value).toBe('x_italic_')
  })
})
