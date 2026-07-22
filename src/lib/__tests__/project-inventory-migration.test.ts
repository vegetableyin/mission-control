import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { rollbackMigration, runMigrations } from '@/lib/migrations'

describe('migration 055_project_inventory', () => {
  let db: Database.Database | undefined

  afterEach(() => db?.close())

  function setup() {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    return db
  }

  it('adds inventory fields and preserves legacy projects', () => {
    const database = setup()
    const general = database.prepare(`SELECT * FROM projects WHERE slug = 'general'`).get() as Record<string, unknown>

    expect(general.status).toBe('in_progress')
    expect(general.project_type).toBe('other')
    expect(general.health_status).toBe('unknown')
    expect(general.scan_enabled).toBe(1)
    expect(general.stale_after_days).toBe(7)
    expect(database.prepare(`SELECT id FROM schema_migrations WHERE id = '055_project_inventory'`).get()).toBeDefined()
  })

  it('is repeatable and reversible', () => {
    const database = setup()
    database.prepare(`DELETE FROM schema_migrations WHERE id = '055_project_inventory'`).run()
    runMigrations(database)
    expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = 'local_path'`).get()).toEqual({ count: 1 })

    rollbackMigration(database, '055_project_inventory')
    expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = 'local_path'`).get()).toEqual({ count: 0 })
    expect(database.prepare(`SELECT id FROM schema_migrations WHERE id = '055_project_inventory'`).get()).toBeUndefined()

    runMigrations(database)
    expect(database.prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = 'local_path'`).get()).toEqual({ count: 1 })
  })
})
