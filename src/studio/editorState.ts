import {
  childLists,
  createBlock,
  emptyDesign,
  newBlockId,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesign,
  type EmailDesignSettings,
} from './model'

/**
 * Where a block list lives: the top level (`parentId: null`) or child list
 * `list` of a container (column index for columns, 1 = else branch of a
 * conditional).
 */
export type Slot = { parentId: string | null; list: number }

export type EditorState = {
  design: EmailDesign
  selectedId: string | null
  past: EmailDesign[]
  future: EmailDesign[]
  clipboard: EmailBlock | null
}

export type EditorAction =
  | { type: 'insert'; block: EmailBlockType | EmailBlock; slot: Slot; index?: number }
  | { type: 'move'; id: string; slot: Slot; index: number }
  | { type: 'nudge'; id: string; direction: -1 | 1 }
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string }
  | { type: 'update'; id: string; patch: Partial<EmailBlock> }
  | { type: 'settings'; patch: Partial<EmailDesignSettings> }
  | { type: 'select'; id: string | null }
  | { type: 'selectSibling'; direction: -1 | 1 }
  | { type: 'copy'; id: string }
  | { type: 'paste' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; design: EmailDesign }

const HISTORY_LIMIT = 100

export const initialEditorState = (design?: EmailDesign | null): EditorState => ({
  design: design ?? emptyDesign(),
  selectedId: null,
  past: [],
  future: [],
  clipboard: null,
})

/** Copies of a block (and its children) with new IDs. */
export const cloneWithNewIds = (block: EmailBlock): EmailBlock => {
  const copy = JSON.parse(JSON.stringify(block)) as EmailBlock
  const renew = (target: EmailBlock) => {
    target.id = newBlockId()
    for (const list of childLists(target)) list.forEach(renew)
  }
  renew(copy)
  return copy
}

/** The block list at a slot, or undefined when the slot does not exist. */
export const listAt = (blocks: EmailBlock[], slot: Slot): EmailBlock[] | undefined => {
  if (slot.parentId === null) return blocks
  const parent = findBlock(blocks, slot.parentId)
  return parent ? childLists(parent.block)[slot.list] : undefined
}

export type Located = { block: EmailBlock; slot: Slot; index: number; parents: string[] }

/** Finds a block and where it lives. */
export const findBlock = (
  blocks: EmailBlock[],
  id: string,
  slot: Slot = { parentId: null, list: 0 },
  parents: string[] = [],
): Located | undefined => {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.id === id) return { block, slot, index, parents }
    const lists = childLists(block)
    for (let list = 0; list < lists.length; list++) {
      const found = findBlock(lists[list], id, { parentId: block.id, list }, [...parents, block.id])
      if (found) return found
    }
  }
  return undefined
}

/** Returns new blocks with the list at `slot` replaced by `update(list)`. */
const updateList = (
  blocks: EmailBlock[],
  slot: Slot,
  update: (list: EmailBlock[]) => EmailBlock[],
): EmailBlock[] => {
  if (slot.parentId === null) return update(blocks)
  return blocks.map((block) => {
    if (block.id === slot.parentId) return withChildList(block, slot.list, update)
    const lists = childLists(block)
    if (!lists.length) return block
    let next = block
    lists.forEach((list, index) => {
      const updated = updateList(list, slot, update)
      if (updated !== list) next = withChildList(next, index, () => updated)
    })
    return next
  })
}

const withChildList = (
  block: EmailBlock,
  list: number,
  update: (list: EmailBlock[]) => EmailBlock[],
): EmailBlock => {
  switch (block.type) {
    case 'section':
    case 'loop':
      return list === 0 ? { ...block, children: update(block.children) } : block
    case 'conditional':
      return list === 0
        ? { ...block, children: update(block.children) }
        : { ...block, elseChildren: update(block.elseChildren ?? []) }
    case 'columns':
      return {
        ...block,
        columns: block.columns.map((column, index) =>
          index === list ? { ...column, children: update(column.children) } : column,
        ),
      }
    default:
      return block
  }
}

const insertAt = (list: EmailBlock[], index: number | undefined, block: EmailBlock) => {
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, at), block, ...list.slice(at)]
}

const commit = (
  state: EditorState,
  design: EmailDesign,
  selectedId = state.selectedId,
): EditorState =>
  design === state.design
    ? { ...state, selectedId }
    : {
        ...state,
        design,
        selectedId,
        past: [...state.past, state.design].slice(-HISTORY_LIMIT),
        future: [],
      }

const withBlocks = (design: EmailDesign, blocks: EmailBlock[]): EmailDesign =>
  blocks === design.blocks ? design : { ...design, blocks }

export const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  const { design } = state
  switch (action.type) {
    case 'insert': {
      if (!listAt(design.blocks, action.slot)) return state
      const block =
        typeof action.block === 'string' ? createBlock(action.block) : cloneWithNewIds(action.block)
      const blocks = updateList(design.blocks, action.slot, (list) =>
        insertAt(list, action.index, block),
      )
      return commit(state, withBlocks(design, blocks), block.id)
    }
    case 'move': {
      const found = findBlock(design.blocks, action.id)
      if (!found || !listAt(design.blocks, action.slot)) return state
      // A block cannot move into itself or its own children.
      if (action.slot.parentId === action.id) return state
      const target = action.slot.parentId
        ? findBlock(design.blocks, action.slot.parentId)
        : undefined
      if (target?.parents.includes(action.id)) return state
      let index = action.index
      const sameList =
        found.slot.parentId === action.slot.parentId && found.slot.list === action.slot.list
      if (sameList && found.index < index) index -= 1
      if (sameList && found.index === index) return state
      const removed = updateList(design.blocks, found.slot, (list) =>
        list.filter((b) => b.id !== action.id),
      )
      const blocks = updateList(removed, action.slot, (list) => insertAt(list, index, found.block))
      return commit(state, withBlocks(design, blocks), action.id)
    }
    case 'nudge': {
      const found = findBlock(design.blocks, action.id)
      if (!found) return state
      const list = listAt(design.blocks, found.slot) ?? []
      const index = found.index + action.direction
      if (index < 0 || index >= list.length) return state
      return editorReducer(state, {
        type: 'move',
        id: action.id,
        slot: found.slot,
        index: action.direction > 0 ? index + 1 : index,
      })
    }
    case 'remove': {
      const found = findBlock(design.blocks, action.id)
      if (!found) return state
      const blocks = updateList(design.blocks, found.slot, (list) =>
        list.filter((b) => b.id !== action.id),
      )
      const siblings = listAt(blocks, found.slot) ?? []
      const next = siblings[Math.min(found.index, siblings.length - 1)]?.id ?? found.slot.parentId
      return commit(state, withBlocks(design, blocks), next ?? null)
    }
    case 'duplicate': {
      const found = findBlock(design.blocks, action.id)
      if (!found) return state
      const copy = cloneWithNewIds(found.block)
      const blocks = updateList(design.blocks, found.slot, (list) =>
        insertAt(list, found.index + 1, copy),
      )
      return commit(state, withBlocks(design, blocks), copy.id)
    }
    case 'update': {
      const found = findBlock(design.blocks, action.id)
      if (!found) return state
      const blocks = updateList(design.blocks, found.slot, (list) =>
        list.map((block) =>
          block.id === action.id
            ? ({ ...block, ...action.patch, id: block.id, type: block.type } as EmailBlock)
            : block,
        ),
      )
      return commit(state, withBlocks(design, blocks))
    }
    case 'settings':
      return commit(state, { ...design, settings: { ...design.settings, ...action.patch } })
    case 'select':
      return { ...state, selectedId: action.id }
    case 'selectSibling': {
      if (!state.selectedId) {
        return design.blocks.length ? { ...state, selectedId: design.blocks[0].id } : state
      }
      const found = findBlock(design.blocks, state.selectedId)
      if (!found) return state
      const list = listAt(design.blocks, found.slot) ?? []
      const next = list[found.index + action.direction]
      return next ? { ...state, selectedId: next.id } : state
    }
    case 'copy': {
      const found = findBlock(design.blocks, action.id)
      return found ? { ...state, clipboard: found.block } : state
    }
    case 'paste': {
      if (!state.clipboard) return state
      const found = state.selectedId ? findBlock(design.blocks, state.selectedId) : undefined
      return editorReducer(state, {
        type: 'insert',
        block: state.clipboard,
        slot: found?.slot ?? { parentId: null, list: 0 },
        index: found ? found.index + 1 : undefined,
      })
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...state,
        design: previous,
        past: state.past.slice(0, -1),
        future: [state.design, ...state.future],
      }
    }
    case 'redo': {
      const [next, ...future] = state.future
      if (!next) return state
      return { ...state, design: next, past: [...state.past, state.design], future }
    }
    case 'reset':
      return initialEditorState(action.design)
  }
}

/** Keyboard shortcuts → actions (null when the key is not a shortcut). */
export const shortcutAction = (
  event: {
    key: string
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
  },
  selectedId: string | null,
  typing: boolean,
): EditorAction | null => {
  const mod = Boolean(event.metaKey || event.ctrlKey)
  const key = event.key.toLowerCase()
  if (mod && key === 'z') return { type: event.shiftKey ? 'redo' : 'undo' }
  if (mod && key === 'y') return { type: 'redo' }
  // Text inputs keep their own copy, paste and arrow keys.
  if (typing) return null
  if (mod && key === 'c' && selectedId) return { type: 'copy', id: selectedId }
  if (mod && key === 'v') return { type: 'paste' }
  if (mod && key === 'd' && selectedId) return { type: 'duplicate', id: selectedId }
  if ((key === 'delete' || key === 'backspace') && selectedId)
    return { type: 'remove', id: selectedId }
  if (key === 'arrowup' || key === 'arrowdown') {
    const direction = key === 'arrowup' ? -1 : 1
    if (event.altKey && selectedId) return { type: 'nudge', id: selectedId, direction }
    return { type: 'selectSibling', direction }
  }
  if (key === 'escape') return { type: 'select', id: null }
  return null
}
