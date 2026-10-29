'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui'
import type {
  NotificationCondition,
  NotificationDedupe,
  NotificationDataSource,
  NotificationDeliveryDefinition,
  NotificationRecipientDefinition,
  NotificationTriggerReliability,
  TriggerSource,
} from '../types'
import { ConditionEditor } from './ConditionEditor'
import {
  BUILDER_STEPS,
  type BuilderRegistry,
  type BuilderSchedule,
  type BuilderStep,
  cleanCondition,
  EMPTY_REGISTRY,
  newDataSource,
  newDelivery,
  newRecipient,
  recipientAliases,
  sampleFor,
  scheduleOfType,
  suggestFields,
  templatesForChannel,
} from './triggerBuilderModel'

const section: React.CSSProperties = { display: 'grid', gap: 8 }
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }
const card: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 8,
  border: '1px solid var(--theme-elevation-150, #ddd)',
  borderRadius: 4,
}
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
}
const pre: React.CSSProperties = {
  ...mono,
  margin: 0,
  padding: 8,
  background: 'var(--theme-elevation-50, #f6f6f6)',
  borderRadius: 4,
  whiteSpace: 'pre-wrap',
  maxHeight: 360,
  overflow: 'auto',
}

const listFrom = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/** Generic list editor: one card per item, add / remove. */
function ListEditor<T>({
  items,
  onChange,
  render,
  addOptions,
  onAdd,
}: {
  items: T[]
  onChange: (items: T[]) => void
  render: (item: T, update: (item: T) => void) => React.ReactNode
  addOptions: string[]
  onAdd: (option: string) => T
}) {
  return (
    <div style={section}>
      {items.map((item, index) => (
        <div key={index} style={card}>
          {render(item, (next) =>
            onChange(items.map((current, i) => (i === index ? next : current))),
          )}
          <div>
            <button type="button" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div style={row}>
        {addOptions.length > 1 ? (
          <select
            aria-label="Add"
            value=""
            onChange={(event) =>
              event.target.value && onChange([...items, onAdd(event.target.value)])
            }
          >
            <option value="">+ Add…</option>
            {addOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" onClick={() => onChange([...items, onAdd(addOptions[0])])}>
            + Add
          </button>
        )}
      </div>
    </div>
  )
}

const Labeled: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>
    {label}
    {children}
  </label>
)

type InnerProps = {
  registry: BuilderRegistry
  registryError?: string
  docId?: number | string
  getDoc: () => Record<string, unknown>
  apiRoute: string
  collectionSlug: string
  /** Step shown first (default: source). */
  initialStep?: BuilderStep
  fields: {
    source: [TriggerSource | undefined, (value: unknown) => void]
    conditions: [NotificationCondition | undefined, (value: unknown) => void]
    data: [{ sources?: NotificationDataSource[] } | undefined, (value: unknown) => void]
    recipients: [NotificationRecipientDefinition[] | undefined, (value: unknown) => void]
    deliveries: [NotificationDeliveryDefinition[] | undefined, (value: unknown) => void]
    schedule: [BuilderSchedule | undefined, (value: unknown) => void]
    dedupe?: [NotificationDedupe | undefined, (value: unknown) => void]
    reliability?: [NotificationTriggerReliability | undefined, (value: unknown) => void]
    classification: [string | undefined, (value: unknown) => void]
    category?: [string | undefined, (value: unknown) => void]
    overrides: [string | undefined, (value: unknown) => void]
  }
}

/** The builder body, independent of Payload hooks (so it can render in tests). */
export const TriggerBuilderInner: React.FC<InnerProps> = ({
  registry,
  registryError,
  docId,
  getDoc,
  apiRoute,
  collectionSlug,
  initialStep = 'source',
  fields,
}) => {
  const [step, setStep] = useState<BuilderStep>(initialStep)
  const [source, setSource] = fields.source
  const [conditions, setConditions] = fields.conditions
  const [data, setData] = fields.data
  const [recipients, setRecipients] = fields.recipients
  const [deliveries, setDeliveries] = fields.deliveries
  const [schedule, setSchedule] = fields.schedule
  const [classification, setClassification] = fields.classification
  const [category, setCategory] = fields.category ?? [undefined, () => undefined]
  const [dedupe, setDedupe] = fields.dedupe ?? [undefined, () => undefined]
  const [reliability, setReliability] = fields.reliability ?? [undefined, () => undefined]
  const [overrides] = fields.overrides

  const collectionSource = source?.type === 'collection'
  const conditionFields = useMemo(
    () => suggestFields(registry, { source, data }),
    [registry, source, data],
  )
  const whenFields = useMemo(
    () => suggestFields(registry, { source, data }, { recipient: true }),
    [registry, source, data],
  )
  const sources = data?.sources ?? []

  const [sampleJson, setSampleJson] = useState(() => sampleFor(registry, source))
  const [documentId, setDocumentId] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const res = await fetch(`${apiRoute}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as Record<string, unknown>
        setOutput(JSON.stringify(json, null, 2))
        return { ok: res.ok, json }
      } catch (error) {
        setOutput(error instanceof Error ? error.message : 'Request failed')
        return { ok: false, json: {} }
      } finally {
        setBusy(false)
      }
    },
    [apiRoute],
  )

  const runTest = (send: boolean) => {
    let payload: unknown = {}
    try {
      payload = JSON.parse(sampleJson || '{}')
    } catch {
      setOutput('Sample payload is not valid JSON')
      return
    }
    void post('/payload-notifications/triggers/test', {
      doc: getDoc(),
      send,
      ...(collectionSource ? { documentId } : { sampleEvent: { payload } }),
    })
  }

  const lifecycle = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!docId) {
      setOutput('Save the trigger first.')
      return
    }
    const result = await post(`/${collectionSlug}/${docId}/lifecycle`, { action, ...extra })
    if (result.ok && action !== 'validate') window.location.reload()
  }

  const stepView = (() => {
    switch (step) {
      case 'source':
        if (overrides) {
          return (
            <p style={{ margin: 0 }}>
              This record customizes the code trigger <code>{overrides}</code>; its source comes
              from code.
            </p>
          )
        }
        return (
          <div style={section}>
            <div style={row}>
              <label>
                <input
                  type="radio"
                  checked={source?.type !== 'collection'}
                  onChange={() =>
                    setSource({ type: 'event', event: registry.events[0]?.name ?? '' })
                  }
                />{' '}
                Application event
              </label>
              <label>
                <input
                  type="radio"
                  checked={source?.type === 'collection'}
                  onChange={() =>
                    setSource({
                      type: 'collection',
                      collection: registry.collectionEvents[0]?.slug ?? '',
                      operation: (registry.collectionEvents[0]?.operations[0] ??
                        'update') as 'update',
                    })
                  }
                />{' '}
                Collection change
              </label>
            </div>
            {source?.type === 'collection' ? (
              <div style={row}>
                <Labeled label="Collection">
                  <select
                    value={source.collection}
                    onChange={(event) => setSource({ ...source, collection: event.target.value })}
                  >
                    {registry.collectionEvents.map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Operation">
                  <select
                    value={source.operation}
                    onChange={(event) =>
                      setSource({ ...source, operation: event.target.value as 'update' })
                    }
                  >
                    {(
                      registry.collectionEvents.find((entry) => entry.slug === source.collection)
                        ?.operations ?? []
                    ).map((operation) => (
                      <option key={operation} value={operation}>
                        {operation}
                      </option>
                    ))}
                  </select>
                </Labeled>
              </div>
            ) : (
              <Labeled label="Event">
                <select
                  value={source?.type === 'event' ? source.event : ''}
                  onChange={(event) => {
                    setSource({ type: 'event', event: event.target.value })
                    setSampleJson(sampleFor(registry, { type: 'event', event: event.target.value }))
                  }}
                >
                  <option value="">Select…</option>
                  {registry.events.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.label} ({entry.name})
                    </option>
                  ))}
                </select>
              </Labeled>
            )}
          </div>
        )

      case 'conditions':
        return (
          <ConditionEditor
            listId="trigger-condition-fields"
            value={conditions}
            onChange={(next) => setConditions(cleanCondition(next) ?? null)}
            fields={conditionFields}
            operators={registry.operators}
            customConditions={registry.conditions}
            collectionSource={collectionSource}
          />
        )

      case 'data':
        return (
          <ListEditor<NotificationDataSource>
            items={sources}
            onChange={(next) => setData(next.length ? { sources: next } : null)}
            addOptions={
              collectionSource
                ? ['collection', 'document', 'resolver', 'computed']
                : ['collection', 'resolver', 'computed', 'event']
            }
            onAdd={(type) => newDataSource(type as NotificationDataSource['type'], sources.length)}
            render={(item, update) => (
              <div style={row}>
                <strong>{item.type}</strong>
                <Labeled label="Alias">
                  <input
                    value={item.alias}
                    onChange={(event) => update({ ...item, alias: event.target.value })}
                  />
                </Labeled>
                {item.type === 'collection' ? (
                  <>
                    <Labeled label="Collection">
                      <select
                        value={item.collection}
                        onChange={(event) =>
                          update({ ...item, collection: event.target.value, fields: [] })
                        }
                      >
                        <option value="">Select…</option>
                        {registry.collections.map((collection) => (
                          <option key={collection.slug} value={collection.slug}>
                            {collection.label}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                    <Labeled label="Lookup">
                      <select
                        value={item.lookup.type}
                        onChange={(event) =>
                          update({
                            ...item,
                            lookup: { ...item.lookup, type: event.target.value as 'id' },
                          })
                        }
                      >
                        <option value="id">by ID at</option>
                        <option value="relationship">relationship at</option>
                      </select>
                    </Labeled>
                    <Labeled label="Path">
                      <input
                        list="trigger-condition-fields"
                        value={item.lookup.from}
                        onChange={(event) =>
                          update({ ...item, lookup: { ...item.lookup, from: event.target.value } })
                        }
                      />
                    </Labeled>
                    <div style={row}>
                      {(
                        registry.collections.find(
                          (collection) => collection.slug === item.collection,
                        )?.fields ?? []
                      ).map((field) => (
                        <label key={field} style={{ fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={item.fields.includes(field)}
                            onChange={(event) =>
                              update({
                                ...item,
                                fields: event.target.checked
                                  ? [...item.fields, field]
                                  : item.fields.filter((current) => current !== field),
                              })
                            }
                          />{' '}
                          {field}
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}
                {item.type === 'resolver' || item.type === 'computed' ? (
                  <Labeled label={item.type === 'resolver' ? 'Resolver' : 'Computed'}>
                    <select
                      value={item.name}
                      onChange={(event) => update({ ...item, name: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {(item.type === 'resolver' ? registry.resolvers : registry.computed).map(
                        (entry) => (
                          <option key={entry.name} value={entry.name}>
                            {entry.label}
                          </option>
                        ),
                      )}
                    </select>
                  </Labeled>
                ) : null}
                {item.type === 'document' || item.type === 'event' ? (
                  <Labeled label="Fields (comma separated, empty = all)">
                    <input
                      value={(item.fields ?? []).join(', ')}
                      onChange={(event) =>
                        update({ ...item, fields: listFrom(event.target.value) })
                      }
                    />
                  </Labeled>
                ) : null}
                {item.type !== 'event' ? (
                  <label style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={item.required !== false}
                      onChange={(event) => update({ ...item, required: event.target.checked })}
                    />{' '}
                    required
                  </label>
                ) : null}
              </div>
            )}
          />
        )

      case 'recipients':
        return (
          <ListEditor<NotificationRecipientDefinition>
            items={recipients ?? []}
            onChange={(next) => setRecipients(next.length ? next : null)}
            addOptions={registry.recipientTypes.length ? registry.recipientTypes : ['eventUser']}
            onAdd={(type) =>
              newRecipient(
                type as NotificationRecipientDefinition['type'],
                (recipients ?? []).length,
              )
            }
            render={(item, update) => (
              <div style={row}>
                <strong>{item.type}</strong>
                <Labeled label="Alias">
                  <input
                    value={item.alias ?? ''}
                    onChange={(event) => update({ ...item, alias: event.target.value })}
                  />
                </Labeled>
                {item.type === 'context' || item.type === 'relationship' ? (
                  <Labeled label="Path to user">
                    <input
                      list="trigger-condition-fields"
                      value={item.path}
                      placeholder="customer.id"
                      onChange={(event) => update({ ...item, path: event.target.value })}
                    />
                  </Labeled>
                ) : null}
                {item.type === 'static' ? (
                  <>
                    <Labeled label="Email">
                      <input
                        value={item.email ?? ''}
                        onChange={(event) =>
                          update({ ...item, email: event.target.value || undefined })
                        }
                      />
                    </Labeled>
                    <Labeled label="Phone (E.164)">
                      <input
                        value={item.phone ?? ''}
                        onChange={(event) =>
                          update({ ...item, phone: event.target.value || undefined })
                        }
                      />
                    </Labeled>
                  </>
                ) : null}
                {item.type === 'role' ? (
                  <Labeled label="Role">
                    <input
                      value={item.role}
                      onChange={(event) => update({ ...item, role: event.target.value })}
                    />
                  </Labeled>
                ) : null}
                {item.type === 'resolver' || item.type === 'query' ? (
                  <Labeled label={item.type === 'resolver' ? 'Resolver' : 'Query'}>
                    <select
                      value={item.name}
                      onChange={(event) => update({ ...item, name: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {(item.type === 'resolver'
                        ? registry.recipientResolvers
                        : registry.recipientQueries
                      ).map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                ) : null}
              </div>
            )}
          />
        )

      case 'deliveries':
        return (
          <ListEditor<NotificationDeliveryDefinition>
            items={deliveries ?? []}
            onChange={(next) => setDeliveries(next)}
            addOptions={['delivery']}
            onAdd={() => newDelivery(registry)}
            render={(item, update) => (
              <div style={section}>
                <div style={row}>
                  <Labeled label="Channel">
                    <select
                      value={item.channel}
                      onChange={(event) => {
                        const channel = event.target
                          .value as NotificationDeliveryDefinition['channel']
                        update({
                          ...item,
                          channel,
                          template: templatesForChannel(registry, channel)[0]?.slug ?? '',
                        })
                      }}
                    >
                      {registry.channels.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Template">
                    <select
                      value={item.template}
                      onChange={(event) => update({ ...item, template: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {templatesForChannel(registry, item.channel).map((template) => (
                        <option key={`${template.source}:${template.slug}`} value={template.slug}>
                          {template.slug} ({template.source === 'code' ? 'code' : template.status})
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Recipient">
                    <select
                      value={item.recipient ?? 'all'}
                      onChange={(event) => update({ ...item, recipient: event.target.value })}
                    >
                      {recipientAliases(recipients).map((alias) => (
                        <option key={alias} value={alias}>
                          {alias}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                </div>
                <div style={row}>
                  <Labeled label="If it can't be sent, fall back to">
                    <select
                      value={item.fallback?.channel ?? ''}
                      onChange={(event) => {
                        const channel = event.target
                          .value as NotificationDeliveryDefinition['channel']
                        update({
                          ...item,
                          fallback: channel ? { ...item.fallback, channel } : undefined,
                        })
                      }}
                    >
                      <option value="">No fallback</option>
                      {registry.channels
                        .filter((channel) => channel !== item.channel)
                        .map((channel) => (
                          <option key={channel} value={channel}>
                            {channel}
                          </option>
                        ))}
                    </select>
                  </Labeled>
                  {item.fallback ? (
                    <Labeled label="Fallback template">
                      <select
                        value={item.fallback.template ?? ''}
                        onChange={(event) =>
                          update({
                            ...item,
                            fallback: {
                              ...item.fallback!,
                              template: event.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">Same as delivery</option>
                        {templatesForChannel(registry, item.fallback.channel).map((template) => (
                          <option key={`${template.source}:${template.slug}`} value={template.slug}>
                            {template.slug}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                  ) : null}
                </div>
                <details>
                  <summary style={{ fontSize: 13 }}>
                    Only send when… {item.when ? '(set)' : ''}
                  </summary>
                  <ConditionEditor
                    listId="trigger-when-fields"
                    value={item.when}
                    onChange={(next) => update({ ...item, when: cleanCondition(next) })}
                    fields={whenFields}
                    operators={registry.operators}
                    customConditions={registry.conditions}
                    collectionSource={collectionSource}
                  />
                </details>
              </div>
            )}
          />
        )

      case 'schedule':
        return (
          <div style={section}>
            <div style={row}>
              <Labeled label="Send">
                <select
                  value={schedule?.type ?? 'immediate'}
                  onChange={(event) =>
                    setSchedule(
                      scheduleOfType(event.target.value as BuilderSchedule['type'], schedule) ??
                        null,
                    )
                  }
                >
                  <option value="immediate">immediately</option>
                  <option value="delay">after a delay</option>
                  <option value="at">at a time from the data</option>
                  <option value="relative">relative to a time from the data</option>
                </select>
              </Labeled>
              {schedule?.type === 'delay' ? (
                <Labeled label="Delay (30m, 24h, 2d)">
                  <input
                    value={String(schedule.delay)}
                    onChange={(event) => setSchedule({ ...schedule, delay: event.target.value })}
                  />
                </Labeled>
              ) : null}
              {schedule?.type === 'at' || schedule?.type === 'relative' ? (
                <Labeled label="Time field">
                  <input
                    list="trigger-condition-fields"
                    value={schedule.at}
                    placeholder="booking.startsAt"
                    onChange={(event) => setSchedule({ ...schedule, at: event.target.value })}
                  />
                </Labeled>
              ) : null}
              {schedule?.type === 'relative' ? (
                <Labeled label="Offset (-24h = before)">
                  <input
                    value={String(schedule.offset)}
                    onChange={(event) => setSchedule({ ...schedule, offset: event.target.value })}
                  />
                </Labeled>
              ) : null}
            </div>
            {schedule ? (
              <div style={row}>
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={schedule.recheckConditions === true}
                    onChange={(event) =>
                      setSchedule({ ...schedule, recheckConditions: event.target.checked })
                    }
                  />{' '}
                  Re-check conditions when due (cancel if they no longer match)
                </label>
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={schedule.skipIfPast === true}
                    onChange={(event) =>
                      setSchedule({ ...schedule, skipIfPast: event.target.checked })
                    }
                  />{' '}
                  Skip if the time has passed
                </label>
              </div>
            ) : null}
            <div style={row}>
              <Labeled label="Dedupe key (skip duplicates across triggers)">
                <input
                  value={dedupe?.key ?? ''}
                  placeholder="order.paid:{{ order.id }}"
                  onChange={(event) =>
                    setDedupe(event.target.value ? { ...dedupe, key: event.target.value } : null)
                  }
                />
              </Labeled>
              {dedupe?.key ? (
                <Labeled label="Within seconds (empty = any age)">
                  <input
                    type="number"
                    value={dedupe.windowSeconds ?? ''}
                    onChange={(event) =>
                      setDedupe({
                        ...dedupe,
                        windowSeconds: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  />
                </Labeled>
              ) : null}
            </div>
            <Labeled label="Send attempts (retries for temporary failures)">
              <input
                type="number"
                min={1}
                value={reliability?.attempts ?? ''}
                placeholder="default"
                onChange={(event) =>
                  setReliability(
                    event.target.value
                      ? { ...reliability, attempts: Number(event.target.value) }
                      : null,
                  )
                }
              />
            </Labeled>
            <Labeled label="Preference category (users can opt out of it)">
              <input
                value={category ?? ''}
                placeholder="e.g. order-updates"
                onChange={(event) => setCategory(event.target.value || null)}
              />
            </Labeled>
            <Labeled label="Classification">
              <select
                value={classification ?? ''}
                onChange={(event) => setClassification(event.target.value || null)}
              >
                <option value="">From the event</option>
                {registry.classifications.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
        )

      case 'test':
        return (
          <div style={section}>
            {collectionSource ? (
              <Labeled label="Test against document ID">
                <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} />
              </Labeled>
            ) : (
              <Labeled label="Sample event payload (JSON)">
                <textarea
                  value={sampleJson}
                  rows={6}
                  style={mono}
                  onChange={(event) => setSampleJson(event.target.value)}
                />
              </Labeled>
            )}
            <div style={row}>
              <button type="button" disabled={busy} onClick={() => runTest(false)}>
                Run test
              </button>
              <button type="button" disabled={busy} onClick={() => runTest(true)}>
                Send test to me
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
              Save before validating or publishing — these act on the saved trigger.
            </p>
            <div style={row}>
              <button type="button" disabled={busy} onClick={() => void lifecycle('validate')}>
                Validate
              </button>
              <button type="button" disabled={busy} onClick={() => void lifecycle('publish')}>
                Publish
              </button>
              <button type="button" disabled={busy} onClick={() => void lifecycle('disable')}>
                Disable
              </button>
              <button type="button" disabled={busy} onClick={() => void lifecycle('enable')}>
                Enable
              </button>
              <button type="button" disabled={busy} onClick={() => void lifecycle('archive')}>
                Archive
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const version = Number(window.prompt('Roll back to version'))
                  if (version) void lifecycle('rollback', { version })
                }}
              >
                Roll back…
              </button>
            </div>
          </div>
        )
    }
  })()

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
      {registryError ? (
        <p style={{ margin: 0, color: 'var(--theme-error-500, #c00)' }}>{registryError}</p>
      ) : null}
      <nav style={row} aria-label="Trigger builder steps">
        {BUILDER_STEPS.map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            aria-current={step === entry.key ? 'step' : undefined}
            onClick={() => setStep(entry.key)}
            style={{ fontWeight: step === entry.key ? 700 : 400 }}
          >
            {index + 1}. {entry.label}
          </button>
        ))}
      </nav>
      {stepView}
      {output ? <pre style={pre}>{output}</pre> : null}
    </div>
  )
}

type TriggerBuilderFieldProps = {
  path?: string
  field?: { admin?: { custom?: { collectionSlug?: string; apiRoute?: string } } }
}

/**
 * Payload admin UI field: a step-by-step editor for a notification trigger's
 * JSON definition fields, with test runs and lifecycle actions.
 */
export const TriggerBuilderField: React.FC<TriggerBuilderFieldProps> = (props) => {
  const custom = props.field?.admin?.custom
  const collectionSlug = custom?.collectionSlug || 'notification-triggers'
  const apiRoute = custom?.apiRoute || '/api'
  const { getData } = useForm()
  const { id } = useDocumentInfo()

  const source = useField<TriggerSource | undefined>({ path: 'source' })
  const conditions = useField<NotificationCondition | undefined>({ path: 'conditions' })
  const data = useField<{ sources?: NotificationDataSource[] } | undefined>({ path: 'data' })
  const recipients = useField<NotificationRecipientDefinition[] | undefined>({ path: 'recipients' })
  const deliveries = useField<NotificationDeliveryDefinition[] | undefined>({ path: 'deliveries' })
  const schedule = useField<BuilderSchedule | undefined>({ path: 'schedule' })
  const dedupe = useField<NotificationDedupe | undefined>({ path: 'dedupe' })
  const reliability = useField<NotificationTriggerReliability | undefined>({ path: 'reliability' })
  const classification = useField<string | undefined>({ path: 'classification' })
  const category = useField<string | undefined>({ path: 'category' })
  const overrides = useField<string | undefined>({ path: 'overrides' })

  const [registry, setRegistry] = useState<BuilderRegistry>(EMPTY_REGISTRY)
  const [registryError, setRegistryError] = useState<string>()

  useEffect(() => {
    let active = true
    fetch(`${apiRoute}/payload-notifications/registry`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load builder options (${res.status})`)
        return (await res.json()) as BuilderRegistry
      })
      .then((loaded) => active && setRegistry({ ...EMPTY_REGISTRY, ...loaded }))
      .catch(
        (error: unknown) =>
          active && setRegistryError(error instanceof Error ? error.message : String(error)),
      )
    return () => {
      active = false
    }
  }, [apiRoute])

  const getDoc = useCallback(() => {
    const value = getData()
    return value && typeof value === 'object' ? value : {}
  }, [getData])

  return (
    <div>
      <div style={{ fontWeight: 600 }}>Trigger builder</div>
      <TriggerBuilderInner
        registry={registry}
        registryError={registryError}
        docId={id}
        getDoc={getDoc}
        apiRoute={apiRoute}
        collectionSlug={collectionSlug}
        fields={{
          source: [source.value, source.setValue],
          conditions: [conditions.value, conditions.setValue],
          data: [data.value, data.setValue],
          recipients: [recipients.value, recipients.setValue],
          deliveries: [deliveries.value, deliveries.setValue],
          schedule: [schedule.value, schedule.setValue],
          dedupe: [dedupe.value, dedupe.setValue],
          reliability: [reliability.value, reliability.setValue],
          classification: [classification.value, classification.setValue],
          category: [category.value, category.setValue],
          overrides: [overrides.value, overrides.setValue],
        }}
      />
    </div>
  )
}

export default TriggerBuilderField
