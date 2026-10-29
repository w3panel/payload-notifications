'use client'

import React from 'react'
import type { ConditionOperator, FieldCondition, NotificationCondition } from '../types'
import {
  addNode,
  type ConditionGroup,
  formatConditionValue,
  groupChildren,
  isGroup,
  newRule,
  type NodePath,
  OPERATOR_LABELS,
  operatorNeedsValue,
  operatorsFor,
  parseConditionValue,
  removeNode,
  replaceNode,
  toEditableGroup,
  toggleGroupType,
} from './triggerBuilderModel'

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
const box: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 8,
  border: '1px solid var(--theme-elevation-150, #ddd)',
  borderRadius: 4,
}

type EditorProps = {
  value: NotificationCondition | undefined
  onChange: (value: ConditionGroup) => void
  fields: string[]
  operators: ConditionOperator[]
  customConditions: Array<{ name: string; label: string }>
  collectionSource: boolean
  /** Unique id for the field datalist. */
  listId: string
}

const RuleRow: React.FC<{
  rule: FieldCondition
  onChange: (rule: FieldCondition) => void
  onRemove: () => void
  operators: ConditionOperator[]
  collectionSource: boolean
  listId: string
}> = ({ rule, onChange, onRemove, operators, collectionSource, listId }) => {
  const available = operatorsFor(rule.field, operators, collectionSource)
  return (
    <div style={row}>
      <input
        aria-label="Field"
        list={listId}
        value={rule.field}
        placeholder="event.payload.total"
        onChange={(event) => onChange({ ...rule, field: event.target.value })}
        style={{ minWidth: 200 }}
      />
      <select
        aria-label="Operator"
        value={rule.operator}
        onChange={(event) => {
          const operator = event.target.value as ConditionOperator
          onChange({
            ...rule,
            operator,
            value: operatorNeedsValue(operator) ? rule.value : undefined,
          })
        }}
      >
        {available.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      {operatorNeedsValue(rule.operator) ? (
        <input
          aria-label="Value"
          value={formatConditionValue(rule.value)}
          placeholder={rule.operator === 'in' || rule.operator === 'notIn' ? 'a, b, c' : 'value'}
          onChange={(event) =>
            onChange({ ...rule, value: parseConditionValue(rule.operator, event.target.value) })
          }
        />
      ) : null}
      <button type="button" onClick={onRemove} aria-label="Remove rule">
        ✕
      </button>
    </div>
  )
}

const GroupEditor: React.FC<{
  group: ConditionGroup
  path: NodePath
  root: ConditionGroup
  onChange: (value: ConditionGroup) => void
  props: Omit<EditorProps, 'value' | 'onChange'>
}> = ({ group, path, root, onChange, props }) => {
  const children = groupChildren(group)
  const setGroup = (next: ConditionGroup) =>
    onChange(path.length ? replaceNode(root, path, next) : next)

  return (
    <div style={box}>
      <div style={row}>
        <button type="button" onClick={() => setGroup(toggleGroupType(group))}>
          {'all' in group ? 'ALL of (AND)' : 'ANY of (OR)'}
        </button>
        <button type="button" onClick={() => onChange(addNode(root, path, newRule()))}>
          + Rule
        </button>
        <button type="button" onClick={() => onChange(addNode(root, path, { any: [] }))}>
          + Group
        </button>
        {props.customConditions.length ? (
          <select
            aria-label="Add custom condition"
            value=""
            onChange={(event) =>
              event.target.value && onChange(addNode(root, path, { custom: event.target.value }))
            }
          >
            <option value="">+ Custom…</option>
            {props.customConditions.map((condition) => (
              <option key={condition.name} value={condition.name}>
                {condition.label}
              </option>
            ))}
          </select>
        ) : null}
        {path.length ? (
          <button type="button" onClick={() => onChange(removeNode(root, path))}>
            Remove group
          </button>
        ) : null}
      </div>
      {children.length === 0 ? (
        <span style={{ fontSize: 12, opacity: 0.7 }}>No rules — always matches.</span>
      ) : null}
      {children.map((child, index) => {
        const childPath = [...path, index]
        if (isGroup(child)) {
          return (
            <GroupEditor
              key={index}
              group={child}
              path={childPath}
              root={root}
              onChange={onChange}
              props={props}
            />
          )
        }
        if ('custom' in child) {
          return (
            <div key={index} style={row}>
              <code>custom: {child.custom}</code>
              <button type="button" onClick={() => onChange(removeNode(root, childPath))}>
                ✕
              </button>
            </div>
          )
        }
        if ('not' in child) {
          return (
            <div key={index} style={row}>
              <code>not: {JSON.stringify(child.not)}</code>
              <button type="button" onClick={() => onChange(removeNode(root, childPath))}>
                ✕
              </button>
            </div>
          )
        }
        return (
          <RuleRow
            key={index}
            rule={child}
            operators={props.operators}
            collectionSource={props.collectionSource}
            listId={props.listId}
            onChange={(rule) => onChange(replaceNode(root, childPath, rule))}
            onRemove={() => onChange(removeNode(root, childPath))}
          />
        )
      })}
    </div>
  )
}

/** Visual editor for JSON condition trees (AND / OR groups, rules, custom conditions). */
export const ConditionEditor: React.FC<EditorProps> = ({ value, onChange, ...props }) => {
  const root = toEditableGroup(value)
  return (
    <>
      <datalist id={props.listId}>
        {props.fields.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      <GroupEditor group={root} path={[]} root={root} onChange={onChange} props={props} />
    </>
  )
}
