import { describe, expect, it } from 'bun:test'
import {
  editorReducer,
  findBlock,
  initialEditorState,
  shortcutAction,
  type EditorAction,
  type EditorState,
} from '../src/studio/editorState'
import type { EmailDesign } from '../src/studio/model'

const design = (): EmailDesign => ({
  version: 1,
  blocks: [
    { id: 'a', type: 'heading', text: 'A' },
    { id: 'sec', type: 'section', children: [{ id: 'b', type: 'text', text: 'B' }] },
    { id: 'c', type: 'text', text: 'C' },
    {
      id: 'cols',
      type: 'columns',
      columns: [{ children: [] }, { children: [{ id: 'd', type: 'spacer', height: 4 }] }],
    },
  ],
})

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state)
const ids = (state: EditorState) => state.design.blocks.map((block) => block.id)

describe('editor state', () => {
  it('inserts a new block into a slot and selects it', () => {
    const state = run(initialEditorState(design()), {
      type: 'insert',
      block: 'button',
      slot: { parentId: 'cols', list: 0 },
    })
    const inserted = findBlock(state.design.blocks, state.selectedId!)
    expect(inserted?.block.type).toBe('button')
    expect(inserted?.slot).toEqual({ parentId: 'cols', list: 0 })
  })

  it('moves blocks within a list and across containers', () => {
    let state = run(initialEditorState(design()), {
      type: 'move',
      id: 'a',
      slot: { parentId: null, list: 0 },
      index: 3,
    })
    expect(ids(state)).toEqual(['sec', 'c', 'a', 'cols'])
    state = run(state, { type: 'move', id: 'c', slot: { parentId: 'sec', list: 0 }, index: 0 })
    expect(findBlock(state.design.blocks, 'c')?.slot).toEqual({ parentId: 'sec', list: 0 })
    expect(ids(state)).toEqual(['sec', 'a', 'cols'])
  })

  it('refuses to move a container into itself', () => {
    const state = initialEditorState({
      version: 1,
      blocks: [
        { id: 's', type: 'section', children: [{ id: 'inner', type: 'section', children: [] }] },
      ],
    })
    expect(
      run(state, { type: 'move', id: 's', slot: { parentId: 'inner', list: 0 }, index: 0 }),
    ).toBe(state)
    expect(run(state, { type: 'move', id: 's', slot: { parentId: 's', list: 0 }, index: 0 })).toBe(
      state,
    )
  })

  it('nudges blocks up and down', () => {
    let state = run(initialEditorState(design()), { type: 'nudge', id: 'c', direction: -1 })
    expect(ids(state)).toEqual(['a', 'c', 'sec', 'cols'])
    state = run(state, { type: 'nudge', id: 'a', direction: 1 })
    expect(ids(state)).toEqual(['c', 'a', 'sec', 'cols'])
    expect(run(state, { type: 'nudge', id: 'c', direction: -1 })).toBe(state)
  })

  it('updates, duplicates and removes blocks', () => {
    let state = run(
      initialEditorState(design()),
      { type: 'update', id: 'b', patch: { text: 'Bee' } as never },
      { type: 'duplicate', id: 'sec' },
    )
    const copy = state.design.blocks[2] as {
      id: string
      children: Array<{ id: string; text: string }>
    }
    expect(copy.id).not.toBe('sec')
    expect(copy.children[0].text).toBe('Bee')
    expect(copy.children[0].id).not.toBe('b')
    state = run(state, { type: 'remove', id: copy.id })
    expect(ids(state)).toEqual(['a', 'sec', 'c', 'cols'])
    expect(state.selectedId).toBe('c')
  })

  it('copies and pastes after the selection', () => {
    const state = run(
      initialEditorState(design()),
      { type: 'copy', id: 'a' },
      { type: 'select', id: 'b' },
      { type: 'paste' },
    )
    const pasted = findBlock(state.design.blocks, state.selectedId!)
    expect(pasted?.block.type).toBe('heading')
    expect(pasted?.slot.parentId).toBe('sec')
    expect(pasted?.index).toBe(1)
  })

  it('undoes and redoes changes', () => {
    let state = run(
      initialEditorState(design()),
      { type: 'remove', id: 'a' },
      { type: 'remove', id: 'c' },
    )
    expect(ids(state)).toEqual(['sec', 'cols'])
    state = run(state, { type: 'undo' })
    expect(ids(state)).toEqual(['sec', 'c', 'cols'])
    state = run(state, { type: 'undo' }, { type: 'redo' })
    expect(ids(state)).toEqual(['sec', 'c', 'cols'])
    // A new change clears the redo stack.
    state = run(state, { type: 'undo' }, { type: 'settings', patch: { width: 640 } })
    expect(state.future).toEqual([])
  })

  it('maps keyboard shortcuts to actions', () => {
    expect(shortcutAction({ key: 'z', metaKey: true }, null, true)).toEqual({ type: 'undo' })
    expect(shortcutAction({ key: 'Z', ctrlKey: true, shiftKey: true }, null, false)).toEqual({
      type: 'redo',
    })
    expect(shortcutAction({ key: 'Delete' }, 'a', false)).toEqual({ type: 'remove', id: 'a' })
    expect(shortcutAction({ key: 'Backspace' }, 'a', true)).toBeNull()
    expect(shortcutAction({ key: 'ArrowUp', altKey: true }, 'a', false)).toEqual({
      type: 'nudge',
      id: 'a',
      direction: -1,
    })
    expect(shortcutAction({ key: 'c', metaKey: true }, 'a', false)).toEqual({
      type: 'copy',
      id: 'a',
    })
  })
})
