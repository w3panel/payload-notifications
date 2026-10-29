import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTrigger,
} from '../types'
import { createSensitiveFieldMatcher } from '../data/sensitive'
import { validateDataSources } from '../data/sources'
import { buildDefinitionFromTemplateDoc } from '../templates/fromDoc'
import {
  availableVariables,
  checkTemplateVariables,
  definitionSources,
} from '../templates/variables'
import { checkTriggerShape } from '../triggers/define'
import { eventMatchesPattern } from '../triggers/match'
import { resolveEffectiveTriggers } from '../triggers/registry'
import { findOverlappingTriggers, validateTrigger } from '../triggers/validate'
import { definitionOf, toAdminTriggerRecord } from './record'
import { loadPublishedAdminTriggers } from './store'

export type TriggerValidationReport = {
  ok: boolean
  errors: string[]
  warnings: string[]
  checkedAt: string
}

type TemplateDoc = Record<string, unknown> & {
  slug?: string
  status?: string
  channels?: string[]
  variables?: Array<{ name?: string; required?: boolean }>
}

const normalizeRegistryDefinition = (
  entry: string | NotificationTemplateDefinition | undefined,
): Partial<NotificationTemplateDefinition> =>
  typeof entry === 'string' ? { body: entry } : (entry ?? {})

/** Roots every trigger context provides. */
const CONTEXT_ROOTS = new Set(['event', 'userId', 'payload', 'trigger', 'recipient'])

/**
 * Builds the trigger the engine would run for a document: a standalone trigger,
 * or — for managed overrides — the code trigger with the record applied.
 */
export const effectiveTriggerFor = (
  doc: Record<string, unknown>,
  options: NormalizedNotificationsPluginOptions,
): { trigger?: NotificationTrigger; errors: string[] } => {
  const slug = String(doc.slug ?? '')
  const record = toAdminTriggerRecord(slug, Number(doc.version ?? 0) + 1, definitionOf(doc))

  if (!record.overrides) {
    const trigger = { enabled: true, ...record } as unknown as NotificationTrigger
    if (!trigger.source) return { errors: [`trigger "${slug}": source is required`] }
    const errors = checkTriggerShape(trigger)
    if (options.triggers.some((code) => code.slug === slug)) {
      errors.push(`trigger "${slug}": slug is used by a code trigger`)
    }
    return { trigger: errors.length ? undefined : trigger, errors }
  }

  const { triggers, errors } = resolveEffectiveTriggers(options.triggers, [record])
  const merged = triggers.find((entry) => entry.overrideOf === record.overrides)
  return { trigger: merged?.trigger, errors }
}

const loadTemplateDocs = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  slugs: string[],
): Promise<TemplateDoc[]> => {
  if (!slugs.length) return []
  const result = await payload.find({
    collection: options.collections.templates as never,
    where: { slug: { in: slugs } },
    limit: 200,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  return result.docs as TemplateDoc[]
}

const hasChannelContent = (doc: TemplateDoc, channel: NotificationChannel): boolean => {
  const definition = buildDefinitionFromTemplateDoc(
    doc as Parameters<typeof buildDefinitionFromTemplateDoc>[0],
    channel,
  )
  return Boolean(definition.body || definition.htmlBody)
}

/**
 * Publish-time validation for an admin trigger document. Combines the
 * code-trigger validators with checks that need the database or registries:
 * registered events, templates with an active variant per channel, required
 * template variables reachable from the context, and classification.
 */
export const validateAdminTrigger = async ({
  payload,
  doc,
  options,
}: {
  payload: Payload
  doc: Record<string, unknown>
  options: NormalizedNotificationsPluginOptions
}): Promise<TriggerValidationReport> => {
  const errors: string[] = []
  const warnings: string[] = []
  const report = (): TriggerValidationReport => ({
    ok: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  })

  const effective = effectiveTriggerFor(doc, options)
  errors.push(...effective.errors.map((error) => error.replace(/^admin trigger "[^"]*": /, '')))
  const trigger = effective.trigger
  if (!trigger) return report()
  const owner = `trigger "${String(doc.slug)}"`

  // Admin-defined sources may only use registered application events (or configured
  // collections); managed overrides keep the code trigger's source.
  if (!doc.overrides && trigger.source.type === 'event') {
    const pattern = trigger.source.event
    const registered = Object.keys(options.events)
    if (!registered.some((name) => eventMatchesPattern(name, pattern))) {
      errors.push(`${owner}: event "${pattern}" is not a registered application event`)
    }
  }

  if (trigger.data) {
    errors.push(
      ...validateDataSources(trigger.data.sources, {
        allowlist: options.data.collections,
        resolvers: Object.keys(options.dataResolvers),
        computed: Object.keys(options.computed),
        isSensitive: createSensitiveFieldMatcher(options.data.sensitiveFields),
        owner,
      }),
    )
  }

  const structural = validateTrigger(trigger, options, owner)
  errors.push(...structural.errors)
  // Registry-variant warnings are superseded by the template checks below.
  warnings.push(...structural.warnings.filter((warning) => !warning.includes('code registry')))

  // Templates: each delivery needs content for its channel (registry or active DB template).
  const keys = [...new Set(trigger.deliveries.map((delivery) => delivery.template))]
  const templateDocs = await loadTemplateDocs(payload, options, keys)
  const aliases = new Set((trigger.data?.sources ?? []).map((source) => source.alias))
  const roots = new Set([...CONTEXT_ROOTS, ...aliases])
  if (trigger.source.type === 'collection') {
    roots.add('doc')
    roots.add('previous')
  }

  trigger.deliveries.forEach((delivery, index) => {
    const label = `${owner} deliveries[${index}]`
    const docs = templateDocs.filter((templateDoc) => templateDoc.slug === delivery.template)
    const active = docs.find(
      (templateDoc) =>
        templateDoc.status === 'active' && hasChannelContent(templateDoc, delivery.channel),
    )
    const inRegistry = Boolean(options.templates.registry[delivery.template]?.[delivery.channel])

    if (!active && !inRegistry) {
      errors.push(
        docs.length
          ? `${label}: template "${delivery.template}" has no active ${delivery.channel} content`
          : `${label}: template "${delivery.template}" does not exist`,
      )
      return
    }

    const definition = active
      ? buildDefinitionFromTemplateDoc(active as never, delivery.channel)
      : normalizeRegistryDefinition(
          options.templates.registry[delivery.template]?.[delivery.channel],
        )
    const variables = checkTemplateVariables(
      definitionSources(definition),
      availableVariables(options, { trigger }),
    )
    warnings.push(
      ...variables.unknown.map(
        (path) =>
          `${label}: template "${delivery.template}" uses "${path}", which this trigger does not provide`,
      ),
    )

    for (const variable of active?.variables ?? []) {
      if (!variable?.required || !variable.name) continue
      const root = variable.name.split('.')[0]
      if (!roots.has(root)) {
        errors.push(
          `${label}: template "${delivery.template}" requires "${variable.name}", which this trigger's context does not provide`,
        )
      }
    }
  })

  const others = [
    ...options.triggers.filter((code) => code.slug !== trigger.slug),
    ...(await loadPublishedAdminTriggers(payload, options))
      .filter((record) => !record.overrides && record.slug !== String(doc.slug) && record.source)
      .map((record) => ({ enabled: true, ...record }) as unknown as NotificationTrigger),
  ]
  warnings.push(
    ...findOverlappingTriggers([trigger, ...others]).filter((warning) =>
      warning.includes(`"${trigger.slug}"`),
    ),
  )

  const eventClassification =
    trigger.source.type === 'event'
      ? options.events[trigger.source.event]?.classification
      : undefined
  if (!trigger.classification && !eventClassification) {
    warnings.push(
      `${owner}: no classification set; deliveries are treated as transactional (no marketing consent check)`,
    )
  }
  if ((trigger.classification ?? eventClassification) === 'marketing' && !options.quietHours) {
    warnings.push(`${owner}: marketing trigger without quietHours configured`)
  }

  return report()
}
