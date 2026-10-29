import { mock } from 'bun:test'

type Doc = Record<string, unknown>
type Where = Record<string, unknown>

const getPath = (doc: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)

const matches = (doc: Doc, where: Where | undefined): boolean => {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'and') return (condition as Where[]).every((clause) => matches(doc, clause))
    if (key === 'or') return (condition as Where[]).some((clause) => matches(doc, clause))
    const value = getPath(doc, key)
    const ops = condition as Record<string, unknown>
    if ('equals' in ops) return String(value) === String(ops.equals)
    if ('not_equals' in ops) return String(value) !== String(ops.not_equals)
    if ('greater_than' in ops) return String(value) > String(ops.greater_than)
    if ('greater_than_equal' in ops) {
      return value !== undefined && String(value) >= String(ops.greater_than_equal)
    }
    if ('less_than' in ops) return value !== undefined && String(value) < String(ops.less_than)
    if ('exists' in ops) return (value !== undefined && value !== null) === Boolean(ops.exists)
    if ('in' in ops) {
      const list = (ops.in as unknown[]).map(String)
      return Array.isArray(value)
        ? value.some((item) => list.includes(String(item)))
        : list.includes(String(value))
    }
    return true
  })
}

/** Fields that must be unique per collection, like the real unique indexes. */
const UNIQUE_FIELDS: Record<string, string[]> = {
  'notification-deliveries': ['idempotencyKey'],
  'notification-events': ['eventId'],
}

/**
 * Minimal in-memory Payload Local API for pipeline tests: find / findByID /
 * create / update over seeded collections, plus mocked jobs, email and logger.
 */
export const createMemoryPayload = (
  seed: Record<string, Doc[]> = {},
  overrides: { queue?: ReturnType<typeof mock>; sendEmail?: ReturnType<typeof mock> } = {},
) => {
  const db: Record<string, Doc[]> = Object.fromEntries(
    Object.entries(seed).map(([slug, docs]) => [slug, docs.map((doc) => ({ ...doc }))]),
  )
  let sequence = 0
  const collection = (slug: string) => (db[slug] ??= [])

  const find = mock(
    async ({
      collection: slug,
      where,
      limit,
    }: {
      collection: string
      where?: Where
      limit?: number
    }) => {
      const docs = collection(slug).filter((doc) => matches(doc, where))
      return { docs: limit ? docs.slice(0, limit) : docs }
    },
  )
  const findByID = mock(async ({ collection: slug, id }: { collection: string; id: unknown }) => {
    return collection(slug).find((doc) => String(doc.id) === String(id)) ?? null
  })
  const create = mock(async ({ collection: slug, data }: { collection: string; data: Doc }) => {
    for (const field of UNIQUE_FIELDS[slug] ?? []) {
      if (collection(slug).some((doc) => doc[field] === data[field])) {
        throw new Error(`duplicate key value violates unique constraint on ${field}`)
      }
    }
    const doc = { id: `${slug}-${++sequence}`, ...data }
    collection(slug).push(doc)
    return doc
  })
  const update = mock(
    async ({
      collection: slug,
      id,
      where,
      data,
    }: {
      collection: string
      id?: unknown
      where?: Where
      data: Doc
    }) => {
      if (id === undefined) {
        // Bulk update by where, like payload.update({ where })
        const docs = collection(slug).filter((doc) => matches(doc, where))
        for (const doc of docs) Object.assign(doc, data)
        return { docs, errors: [] }
      }
      const doc = collection(slug).find((entry) => String(entry.id) === String(id))
      if (!doc) throw new Error(`Not found: ${slug}/${String(id)}`)
      Object.assign(doc, data)
      return doc
    },
  )
  const remove = mock(
    async ({ collection: slug, where }: { collection: string; where?: Where }) => {
      const docs = collection(slug).filter((doc) => matches(doc, where))
      db[slug] = collection(slug).filter((doc) => !docs.includes(doc))
      return { docs, errors: [] }
    },
  )
  const queue = overrides.queue ?? mock(async () => undefined)
  const sendEmail = overrides.sendEmail ?? mock(async () => undefined)
  const logger = {
    warn: mock(() => undefined),
    error: mock(() => undefined),
    info: mock(() => undefined),
  }

  const payload = {
    find,
    findByID,
    create,
    update,
    delete: remove,
    jobs: { queue },
    sendEmail,
    logger,
  }

  return {
    payload: payload as never,
    db,
    find,
    findByID,
    create,
    update,
    remove,
    queue,
    sendEmail,
    logger,
    /** Docs created in a collection. */
    docs: (slug: string) => collection(slug),
  }
}
