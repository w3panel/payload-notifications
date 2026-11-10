import { describe, expect, it } from 'bun:test'
import { fixSqliteTableRebuilds } from '../src/migrations/fixSqliteRebuild'

const migration = `
  await db.run(sql\`CREATE TABLE \\\`__new_notification_templates\\\` (\\\`id\\\` integer PRIMARY KEY NOT NULL, \\\`slug\\\` text NOT NULL, \\\`version\\\` numeric DEFAULT 0, \\\`locale\\\` text);\`)
  await db.run(sql\`INSERT INTO \\\`__new_notification_templates\\\`("id", "slug", "version", "locale", "email_design") SELECT "id", "slug", "version", "locale", "email_design" FROM \\\`notification_templates\\\`;\`)
  await db.run(sql\`INSERT INTO \\\`__new_other\\\`("id") SELECT "id" FROM \\\`other\\\`;\`)
`

const previous = {
  tables: {
    notification_templates: { columns: { id: {}, slug: {}, version: {} } },
    other: { columns: { id: {} } },
  },
}

describe('fixSqliteTableRebuilds', () => {
  it('copies only columns from the previous snapshot', () => {
    const { source, fixes } = fixSqliteTableRebuilds(migration, previous)
    expect(fixes).toEqual([
      { table: 'notification_templates', dropped: ['locale', 'email_design'] },
    ])
    expect(source).toContain(
      'INSERT INTO \\`__new_notification_templates\\`("id", "slug", "version") SELECT "id", "slug", "version" FROM \\`notification_templates\\`',
    )
    expect(source).toContain('INSERT INTO \\`__new_other\\`("id") SELECT "id" FROM \\`other\\`')
    // Unescaped SQL (e.g. a .sql file) works too.
    const plain = fixSqliteTableRebuilds(
      'INSERT INTO `__new_t`("id", "x") SELECT "id", "x" FROM `t`;',
      { tables: { t: { columns: { id: {} } } } },
    )
    expect(plain.source).toBe('INSERT INTO `__new_t`("id") SELECT "id" FROM `t`;')
  })

  it('leaves migrations alone when nothing is missing or the table is unknown', () => {
    expect(fixSqliteTableRebuilds(migration, { tables: {} }).fixes).toEqual([])
    const full = {
      tables: {
        notification_templates: {
          columns: { id: {}, slug: {}, version: {}, locale: {}, email_design: {} },
        },
      },
    }
    expect(fixSqliteTableRebuilds(migration, full).source).toBe(migration)
  })

  it('does not touch copies with expressions', () => {
    const expr = 'INSERT INTO `__new_t`("id", "n") SELECT "id", coalesce("n", 0) FROM `t`'
    const result = fixSqliteTableRebuilds(expr, { tables: { t: { columns: { id: {} } } } })
    expect(result.source).toBe(expr)
  })
})
