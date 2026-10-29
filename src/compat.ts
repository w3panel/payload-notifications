import type { CollectionConfig, Config } from 'payload'
import * as payloadModule from 'payload'

/**
 * Payload 3 / 4 differences the plugin adapts to:
 * - Payload 4 adds collection `authorship` (createdBy / updatedBy); plugin
 *   collections opt out. Payload 3 has no such option.
 * - Payload 4 always supports job concurrency keys; Payload 3 only with
 *   `jobs.enableConcurrencyControl: true` (it adds an indexed jobs field and
 *   needs a migration, so the plugin never switches it on for you).
 *
 * Detected by a Payload-4-only export so one build serves both.
 */
export const isPayload4 = 'createCreatedByField' in payloadModule

/** Collection options that only exist in Payload 4. */
export const versionedCollectionDefaults = (): Partial<CollectionConfig> =>
  isPayload4 ? ({ authorship: false } as unknown as Partial<CollectionConfig>) : {}

/** Whether tasks may declare `concurrency` keys under this config. */
export const supportsTaskConcurrency = (config: Pick<Config, 'jobs'>): boolean =>
  isPayload4 ||
  (config.jobs as { enableConcurrencyControl?: boolean } | undefined)?.enableConcurrencyControl ===
    true
