import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { compileDesignEndpoint } from '../src/endpoints/compileDesign'
import { unknownTemplatePaths } from '../src/admin/studio/CodeVariablesPanel'
import {
  BACK_TO_VISUAL_WARNING,
  convertToCode,
  CONVERT_TO_CODE_WARNING,
  START_VISUAL_WARNING,
  switchToVisual,
} from '../src/admin/studio/EditorModeBar'
import {
  registerVariableCompletion,
  variableCompletions,
  type MonacoLike,
} from '../src/admin/studio/monacoVariables'
import type { EmailDesign } from '../src/studio/model'

const design: EmailDesign = {
  version: 1,
  blocks: [{ id: 't', type: 'text', text: 'Hi {{ recipient.name }}' }],
}

describe('compile-design endpoint', () => {
  const endpoint = compileDesignEndpoint(() => normalizePluginOptions({}))
  const req = (body: unknown, user: unknown = { id: 'u' }) =>
    ({
      user,
      json: async () => body,
      payload: {
        findGlobal: async () => ({ footerText: 'Theme' }),
        findByID: async () => null,
        config: {},
      },
    }) as never

  it('compiles a design with the theme', async () => {
    const res = await endpoint.handler(
      req({
        design: { ...design, blocks: [...design.blocks, { id: 'f', type: 'footer', text: '' }] },
      }),
    )
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.html).toContain('Hi {{ recipient.name }}')
    expect(body.html).toContain('Theme')
    expect(body.text).toContain('Hi {{ recipient.name }}')
  })

  it('rejects invalid designs, bad images and anonymous calls', async () => {
    expect(
      (await endpoint.handler(req({ design: { version: 1, blocks: [{ id: 'x', type: 'nope' }] } })))
        .status,
    ).toBe(400)
    const image = await endpoint.handler(
      req({
        design: { version: 1, blocks: [{ id: 'i', type: 'image', src: '/a.png', alt: 'A' }] },
      }),
    )
    expect((await image.json()).errors).toEqual([
      'image "A": the image URL must be absolute (https://…)',
    ])
    expect((await endpoint.handler(req({ design }, null))).status).toBe(401)
  })
})

describe('switching editor modes', () => {
  const setup = (
    answer: boolean,
    compileResult: { html: string; text: string } | { error: string } = {
      html: '<p>x</p>',
      text: 'x',
    },
  ) => {
    const calls: string[] = []
    return {
      calls,
      actions: {
        design,
        setEditor: mock((value: string) => calls.push(`editor:${value}`)),
        setDesign: mock(() => calls.push('design')),
        setBodies: mock((bodies: { html: string }) => calls.push(`bodies:${bodies.html}`)),
        compile: mock(async () => compileResult),
        confirm: mock((message: string) => {
          calls.push(`confirm:${message}`)
          return answer
        }),
      },
    }
  }

  it('converts to code after a warning, writing the compiled bodies', async () => {
    const { calls, actions } = setup(true)
    expect(await convertToCode(actions)).toBe('Converted to HTML. Save to keep the change.')
    expect(calls).toEqual([`confirm:${CONVERT_TO_CODE_WARNING}`, 'bodies:<p>x</p>', 'editor:code'])
  })

  it('does nothing when the warning is cancelled or compiling fails', async () => {
    const cancelled = setup(false)
    await convertToCode(cancelled.actions)
    expect(cancelled.calls).toEqual([`confirm:${CONVERT_TO_CODE_WARNING}`])
    const failed = setup(true, { error: 'Fix the images first' })
    expect(await convertToCode(failed.actions)).toBe('Fix the images first')
    expect(failed.calls).toHaveLength(1)
  })

  it('switches back to visual with the stored design or starts one', () => {
    const back = setup(true)
    expect(switchToVisual(back.actions)).toBe(true)
    expect(back.calls).toEqual([`confirm:${BACK_TO_VISUAL_WARNING}`, 'editor:visual'])
    const fresh = setup(true)
    expect(switchToVisual({ ...fresh.actions, design: null })).toBe(true)
    expect(fresh.calls).toEqual([`confirm:${START_VISUAL_WARNING}`, 'design', 'editor:visual'])
  })
})

describe('code mode variables', () => {
  const monaco: MonacoLike = {
    languages: {
      CompletionItemKind: { Variable: 4 },
      registerCompletionItemProvider: mock(() => ({ dispose: mock(() => {}) })),
    },
  }
  const model = (line: string) => ({ getLineContent: () => line })

  it('offers {{ completions in Monaco and replaces a closing brace pair', () => {
    const result = variableCompletions(
      monaco,
      model('<p>{{ pay }}</p>'),
      { lineNumber: 3, column: 10 },
      ['payload.orderId', 'recipient.name'],
    )
    expect(result.suggestions).toEqual([
      {
        label: 'payload.orderId',
        kind: 4,
        insertText: '{{ payload.orderId }}',
        filterText: '{{pay',
        range: { startLineNumber: 3, endLineNumber: 3, startColumn: 4, endColumn: 13 },
      },
    ])
    expect(
      variableCompletions(monaco, model('<p>plain</p>'), { lineNumber: 1, column: 5 }, ['a'])
        .suggestions,
    ).toEqual([])
  })

  it('registers for HTML and plain text and disposes both', () => {
    const registration = registerVariableCompletion(monaco, () => [])
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(2)
    registration.dispose()
  })

  it('lists unknown variables used in code', () => {
    const roots = { payload: ['orderId', 'items'], recipient: null }
    expect(
      unknownTemplatePaths(
        [
          'Order {{ payload.orderId }}',
          '{{#each payload.items}}{{ name }}{{/each}} {{ payload.total }} {{ order.id }}',
          null,
        ],
        roots,
      ),
    ).toEqual(['order.id', 'payload.total'])
  })
})
