'use client'

import React, { useEffect, useMemo, useReducer, useRef } from 'react'
import {
  editorReducer,
  findBlock,
  initialEditorState,
  shortcutAction,
} from '../../studio/editorState'
import { BLOCK_TYPES, type EmailBlockType, type EmailDesign } from '../../studio/model'
import { designVariableIssues, type VariableRoots } from '../../studio/variables'
import { BlockCanvas, BLOCK_LABELS, DRAG_NEW } from './BlockCanvas'
import {
  BlockProperties,
  DesignSettings,
  type MediaOption,
  type PartialOption,
} from './BlockProperties'

export type VisualEmailEditorProps = {
  design: EmailDesign | null | undefined
  onChange: (design: EmailDesign) => void
  /** Variable paths for the picker and `{{` autocomplete. */
  variables?: string[]
  /** What the selected event provides; unknown variables are highlighted. Omit to skip checks. */
  roots?: VariableRoots
  /** Other problems per block ID (e.g. accessibility checks). */
  problems?: Record<string, string[]>
  canRawHtml?: boolean
  media?: MediaOption[]
  partials?: PartialOption[]
}

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  const tag = element?.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(element?.isContentEditable)
  )
}

/**
 * Block-based email designer: palette, canvas and properties. Every change is
 * reported through `onChange` (the template's `email.design`).
 */
export const VisualEmailEditor: React.FC<VisualEmailEditorProps> = ({
  design,
  onChange,
  variables,
  roots,
  problems: extraProblems,
  canRawHtml,
  media,
  partials,
}) => {
  const [state, dispatch] = useReducer(editorReducer, design, initialEditorState)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    onChange(state.design)
    // Only design changes are reported (onChange may be a new function each render).
  }, [state.design])

  const { unknown, problems } = useMemo(() => {
    const issues = roots ? designVariableIssues(state.design, roots) : {}
    const unknownByBlock: Record<string, string[]> = {}
    const merged: Record<string, string[]> = { ...extraProblems }
    for (const [id, list] of Object.entries(issues)) {
      unknownByBlock[id] = list.flatMap((issue) => (issue.expression ? [issue.expression] : []))
      merged[id] = [...(merged[id] ?? []), ...list.map((issue) => issue.message)]
    }
    return { unknown: unknownByBlock, problems: merged }
  }, [state.design, roots, extraProblems])

  const selected = state.selectedId ? findBlock(state.design.blocks, state.selectedId) : undefined
  const palette = BLOCK_TYPES.filter((type) => type !== 'html' || canRawHtml)

  const addBlock = (type: EmailBlockType) =>
    dispatch({
      type: 'insert',
      block: type,
      slot: selected?.slot ?? { parentId: null, list: 0 },
      index: selected ? selected.index + 1 : undefined,
    })

  return (
    <div
      className="pn-designer-wrap"
      onKeyDown={(event) => {
        const action = shortcutAction(event, state.selectedId, isTyping(event.target))
        if (!action) return
        event.preventDefault()
        dispatch(action)
      }}
    >
      <div className="pn-toolbar" role="toolbar" aria-label="Designer">
        <button
          type="button"
          disabled={!state.past.length}
          onClick={() => dispatch({ type: 'undo' })}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!state.future.length}
          onClick={() => dispatch({ type: 'redo' })}
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          disabled={!state.clipboard}
          onClick={() => dispatch({ type: 'paste' })}
          title="Paste (Ctrl/Cmd+V)"
        >
          Paste
        </button>
        <span className="pn-hint">
          Drag blocks onto the canvas or click to add after the selection. Keys: ↑/↓ select, Alt+↑/↓
          move, Delete, Ctrl/Cmd+C / V / D / Z.
        </span>
      </div>
      <div className="pn-designer">
        <div className="pn-palette" aria-label="Blocks">
          <div className="pn-panel-title">Blocks</div>
          {palette.map((type) => (
            <button
              key={type}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_NEW, type)
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addBlock(type)}
            >
              {BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
        <BlockCanvas
          design={state.design}
          selectedId={state.selectedId}
          dispatch={dispatch}
          unknown={unknown}
          problems={problems}
        />
        {selected ? (
          <BlockProperties
            key={selected.block.id}
            block={selected.block}
            dispatch={dispatch}
            variables={variables}
            canRawHtml={canRawHtml}
            media={media}
            partials={partials}
            problems={problems?.[selected.block.id]}
          />
        ) : (
          <DesignSettings settings={state.design.settings ?? {}} dispatch={dispatch} />
        )}
      </div>
    </div>
  )
}
