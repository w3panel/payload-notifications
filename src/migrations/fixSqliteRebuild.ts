/**
 * SQLite / D1 cannot change a column default in place, so drizzle rebuilds the
 * table: create `__new_<table>`, `INSERT … SELECT` from the old table, rename.
 * When the same migration also adds columns, the generated copy selects columns
 * the old table does not have yet and the migration fails with "no such column".
 *
 * This rewrites every such copy statement to the columns that existed in the
 * previous snapshot. New columns are left to their defaults / NULL.
 */

/** Drizzle SQLite snapshot (the `.json` written next to each migration). */
export type SqliteSnapshot = {
  tables?: Record<string, { columns?: Record<string, unknown> }>
}

export type SqliteRebuildFix = { table: string; dropped: string[] }

// Quotes may be escaped (\`) inside the TypeScript source of a migration.
const Q = '(?:\\\\?[`"])'
const COPY = new RegExp(
  `(INSERT INTO ${Q}__new_([A-Za-z0-9_]+)${Q}\\s*)\\(([^)]*)\\)(\\s*SELECT\\s+)([\\s\\S]*?)(\\s+FROM\\s+${Q}\\2${Q})`,
  'g',
)

const splitColumns = (list: string) =>
  list
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)

const bare = (column: string) => column.replace(/^\\?[`"]|\\?[`"]$/g, '')

export const fixSqliteTableRebuilds = (
  migrationSource: string,
  previousSnapshot: SqliteSnapshot,
): { source: string; fixes: SqliteRebuildFix[] } => {
  const fixes: SqliteRebuildFix[] = []
  const source = migrationSource.replace(
    COPY,
    (
      statement,
      head: string,
      table: string,
      insertList: string,
      select: string,
      selectList: string,
      from: string,
    ) => {
      const existing = previousSnapshot.tables?.[table]?.columns
      if (!existing) return statement
      const inserted = splitColumns(insertList)
      const selected = splitColumns(selectList)
      // Only rewrite plain column copies; leave expressions alone.
      if (inserted.length !== selected.length) return statement
      if (selected.some((column, i) => bare(column) !== bare(inserted[i]))) return statement

      const keep = inserted.filter((column) => bare(column) in existing)
      const dropped = inserted.filter((column) => !(bare(column) in existing)).map(bare)
      if (!dropped.length) return statement
      fixes.push({ table, dropped })
      const columns = keep.join(', ')
      return `${head}(${columns})${select}${columns}${from}`
    },
  )
  return { source, fixes }
}
