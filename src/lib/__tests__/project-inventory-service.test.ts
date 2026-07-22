import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { getProjectScanHistory, scanRegisteredProject } from '@/lib/project-inventory'
import type { ProjectScanConfig } from '@/lib/project-scan-config'

describe('project inventory scanning service', () => {
  let db: Database.Database | undefined
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    db?.close()
    db = undefined
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  async function setupRepository() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mc-inventory-service-'))
    temporaryDirectories.push(root)
    const repository = path.join(root, '中文 project')
    await mkdir(repository)
    execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'mission-control-tests@example.invalid'], { cwd: repository })
    execFileSync('git', ['config', 'user.name', 'Mission Control Tests'], { cwd: repository })
    await writeFile(path.join(repository, 'README.md'), '# fixture\n')
    execFileSync('git', ['add', 'README.md'], { cwd: repository })
    execFileSync('git', ['commit', '-m', 'Initial fixture'], { cwd: repository, stdio: 'ignore' })
    await writeFile(path.join(repository, 'untracked.txt'), 'dirty\n')
    return { root, repository }
  }

  function setupDatabase(localPath: string, scanEnabled = 1) {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    const result = db.prepare(`
      INSERT INTO projects (
        workspace_id, name, slug, ticket_prefix, status, local_path, project_type,
        scan_enabled, stale_after_days, next_action, health_status, created_at, updated_at
      ) VALUES (1, 'Inventory fixture', 'inventory-fixture', 'INV', 'in_progress', ?, 'node', ?, 7, 'Review scan', 'unknown', unixepoch(), unixepoch())
    `).run(localPath, scanEnabled)
    return Number(result.lastInsertRowid)
  }

  function config(root: string): ProjectScanConfig {
    return { roots: [root], maxDepth: 2, scanTimeoutMs: 10_000, gitCommandTimeoutMs: 5_000, defaultStaleDays: 7 }
  }

  it('stores read-only Git metadata, health, dirty state, and scan history', async () => {
    const { root, repository } = await setupRepository()
    const projectId = setupDatabase(repository)

    const project = await scanRegisteredProject(db!, 1, projectId, config(root))

    expect(project.local_path).toBe(repository)
    expect(project.git_head_sha).toMatch(/^[0-9a-f]{40}$/)
    expect(project.git_last_commit_title).toBe('Initial fixture')
    expect(project.git_dirty).toBe(true)
    expect(project.git_untracked_count).toBe(1)
    expect(project.repository_accessible).toBe(true)
    expect(project.health_status).toBe('healthy')
    expect(Number(project.dirty_since_at)).toBeGreaterThan(0)
    expect(getProjectScanHistory(db!, 1, projectId)).toHaveLength(1)
  })

  it('fails closed when scanning is disabled', async () => {
    const { root, repository } = await setupRepository()
    const projectId = setupDatabase(repository, 0)

    await expect(scanRegisteredProject(db!, 1, projectId, config(root))).rejects.toThrow('disabled')
    expect(getProjectScanHistory(db!, 1, projectId)).toHaveLength(0)
  })

  it('records an inaccessible registered directory as blocked without escaping roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mc-inventory-missing-'))
    temporaryDirectories.push(root)
    const missing = path.join(root, 'removed-project')
    const projectId = setupDatabase(missing)

    const project = await scanRegisteredProject(db!, 1, projectId, config(root))

    expect(project.health_status).toBe('blocked')
    expect(project.repository_accessible).toBe(false)
    expect(String(project.scan_error)).toBeTruthy()
    expect(getProjectScanHistory(db!, 1, projectId)[0]).toMatchObject({ status: 'error' })
  })
})
