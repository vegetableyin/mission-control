import path from 'node:path'
import { readdir } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { calculateProjectHealth, projectInventorySortRank, type ProjectHealthReason } from './project-health'
import { readGitProjectMetadata, type GitProjectMetadata } from './project-git'
import { getProjectScanConfig, resolveAllowedProjectPath, type ProjectScanConfig } from './project-scan-config'

export const PROJECT_INVENTORY_COLUMNS = `
  p.id, p.workspace_id, p.name, p.slug, p.description, p.ticket_prefix, p.ticket_counter, p.status,
  p.github_repo, p.github_repository, p.deadline, p.color, p.github_sync_enabled,
  p.github_labels_initialized, p.github_default_branch, p.project_type, p.local_path,
  p.owner, p.customer, p.stage, p.health_status, p.health_score, p.priority,
  p.next_action, p.blocker, p.last_activity_at, p.last_scan_at, p.archived,
  p.scan_enabled, p.stale_after_days, p.git_branch, p.git_head_sha,
  p.git_last_commit_at, p.git_last_commit_title, p.git_dirty, p.git_modified_count,
  p.git_untracked_count, p.git_ahead_count, p.git_behind_count, p.git_detached_head,
  p.git_has_origin, p.git_origin_url, p.repository_accessible, p.dirty_since_at,
  p.health_reasons, p.scan_error, p.created_at, p.updated_at
`

export interface ProjectInventoryRecord extends Record<string, unknown> {
  id: number
  workspace_id: number
  name: string
  status: string
  local_path?: string | null
  scan_enabled?: number | boolean
  archived?: number | boolean
  stale_after_days?: number
  next_action?: string | null
  updated_at?: number | null
  dirty_since_at?: number | null
  health_reasons?: ProjectHealthReason[] | string | null
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function serializeProjectInventory(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    github_repository: row.github_repository || row.github_repo || null,
    archived: Boolean(row.archived || row.status === 'archived'),
    scan_enabled: Boolean(row.scan_enabled),
    git_dirty: row.git_dirty === null || row.git_dirty === undefined ? null : Boolean(row.git_dirty),
    git_detached_head: row.git_detached_head === null || row.git_detached_head === undefined ? null : Boolean(row.git_detached_head),
    git_has_origin: row.git_has_origin === null || row.git_has_origin === undefined ? null : Boolean(row.git_has_origin),
    repository_accessible: row.repository_accessible === null || row.repository_accessible === undefined ? null : Boolean(row.repository_accessible),
    health_reasons: parseJson<ProjectHealthReason[]>(row.health_reasons, []),
  }
}

export function sortProjectInventory<T extends { status: string; health_status?: string | null; archived?: number | boolean; priority?: unknown; last_activity_at?: unknown }>(projects: T[]): T[] {
  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return [...projects].sort((a, b) => {
    const rank = projectInventorySortRank(a) - projectInventorySortRank(b)
    if (rank !== 0) return rank
    const priority = (priorityRank[String(a.priority)] ?? 2) - (priorityRank[String(b.priority)] ?? 2)
    if (priority !== 0) return priority
    return Number(b.last_activity_at || 0) - Number(a.last_activity_at || 0)
  })
}

function projectTaskSignals(db: Database.Database, workspaceId: number, projectId: number, now: number) {
  const taskSignals = db.prepare(`
    SELECT
      MAX(updated_at) AS last_task_at,
      SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS recent_failed_tasks,
      SUM(CASE WHEN status IN ('awaiting_owner', 'review', 'quality_review') THEN 1 ELSE 0 END) AS attention_tasks
    FROM tasks
    WHERE workspace_id = ? AND project_id = ?
  `).get(now - 7 * 86400, workspaceId, projectId) as { last_task_at: number | null; recent_failed_tasks: number | null; attention_tasks: number | null }
  const runSignal = db.prepare(`
    SELECT MAX(r.created_at) AS last_run_at
    FROM runs r
    JOIN tasks t ON CAST(t.id AS TEXT) = r.task_id AND t.workspace_id = r.workspace_id
    WHERE r.workspace_id = ? AND t.project_id = ?
  `).get(workspaceId, projectId) as { last_run_at: number | null }
  return { ...taskSignals, last_run_at: runSignal.last_run_at }
}

function scanHistoryPayload(git: GitProjectMetadata | null, health: ReturnType<typeof calculateProjectHealth>) {
  return {
    git: git ? JSON.stringify(git) : null,
    health: JSON.stringify(health),
  }
}

export async function scanRegisteredProject(
  db: Database.Database,
  workspaceId: number,
  projectId: number,
  config: ProjectScanConfig = getProjectScanConfig(),
): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  const project = db.prepare(`SELECT ${PROJECT_INVENTORY_COLUMNS} FROM projects p WHERE p.id = ? AND p.workspace_id = ?`)
    .get(projectId, workspaceId) as ProjectInventoryRecord | undefined
  if (!project) throw new Error('Project not found')
  if (!project.local_path) throw new Error('Project does not have a local path')
  if (!project.scan_enabled) throw new Error('Project scanning is disabled')

  const now = Math.floor(Date.now() / 1000)
  let resolvedPath: string | null = null
  let directoryExists = false
  let directoryEntryCount: number | null = null
  let git: GitProjectMetadata | null = null
  let scanError: string | null = null
  try {
    resolvedPath = await resolveAllowedProjectPath(String(project.local_path), config.roots)
    directoryExists = true
    const entries = await readdir(resolvedPath, { withFileTypes: true })
    directoryEntryCount = entries.filter((entry) => !entry.name.startsWith('.')).length
    if (entries.some((entry) => entry.name === '.git')) {
      git = await readGitProjectMetadata(resolvedPath, config.gitCommandTimeoutMs)
      if (git.error) scanError = git.error
    }
  } catch (error) {
    scanError = error instanceof Error ? error.message : 'Project scan failed'
  }

  const taskSignals = projectTaskSignals(db, workspaceId, projectId, now)
  const dirtySinceAt = git?.dirty ? Number(project.dirty_since_at || now) : null
  const lastActivityAt = [git?.lastCommitAt, taskSignals.last_task_at, taskSignals.last_run_at, project.updated_at]
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => b - a)[0] ?? null
  const health = calculateProjectHealth({
    status: String(project.status),
    localPath: String(project.local_path),
    directoryExists,
    directoryEntryCount,
    nextAction: typeof project.next_action === 'string' ? project.next_action : null,
    staleAfterDays: Number(project.stale_after_days || config.defaultStaleDays),
    lastActivityAt,
    dirtySinceAt,
    git: git || (scanError ? {
      isGit: false, accessible: false, branch: null, headSha: null, lastCommitAt: null,
      lastCommitTitle: null, dirty: false, modifiedCount: 0, untrackedCount: 0,
      aheadCount: null, behindCount: null, detachedHead: false, hasOrigin: false,
      originUrl: null, upstream: null, error: scanError, timedOut: scanError.includes('timed out'),
    } : null),
    recentFailedTasks: Number(taskSignals.recent_failed_tasks || 0),
    attentionTasks: Number(taskSignals.attention_tasks || 0),
  })
  const payload = scanHistoryPayload(git, health)

  db.transaction(() => {
    db.prepare(`
      UPDATE projects SET
        local_path = ?, github_repository = COALESCE(github_repository, ?),
        health_status = ?, health_score = ?, health_reasons = ?, last_activity_at = ?,
        last_scan_at = ?, scan_error = ?, dirty_since_at = ?,
        git_branch = ?, git_head_sha = ?, git_last_commit_at = ?, git_last_commit_title = ?,
        git_dirty = ?, git_modified_count = ?, git_untracked_count = ?,
        git_ahead_count = ?, git_behind_count = ?, git_detached_head = ?,
        git_has_origin = ?, git_origin_url = ?, repository_accessible = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      resolvedPath || project.local_path,
      git?.originUrl || null,
      health.status, health.score, JSON.stringify(health.reasons), lastActivityAt,
      now, scanError, dirtySinceAt,
      git?.branch ?? null, git?.headSha ?? null, git?.lastCommitAt ?? null, git?.lastCommitTitle ?? null,
      git ? Number(git.dirty) : null, git?.modifiedCount ?? null, git?.untrackedCount ?? null,
      git?.aheadCount ?? null, git?.behindCount ?? null, git ? Number(git.detachedHead) : null,
      git ? Number(git.hasOrigin) : null, git?.originUrl ?? null, git ? Number(git.accessible) : scanError ? 0 : null,
      projectId, workspaceId,
    )
    db.prepare(`
      INSERT INTO project_scan_history (workspace_id, project_id, status, duration_ms, git_json, health_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, projectId, scanError ? 'error' : 'success', Date.now() - startedAt, payload.git, payload.health, scanError)
  })()

  const updated = db.prepare(`SELECT ${PROJECT_INVENTORY_COLUMNS} FROM projects p WHERE p.id = ? AND p.workspace_id = ?`).get(projectId, workspaceId) as Record<string, unknown>
  return serializeProjectInventory(updated)
}

export async function scanAllRegisteredProjects(
  db: Database.Database,
  workspaceId: number,
  config: ProjectScanConfig = getProjectScanConfig(),
) {
  const startedAt = Date.now()
  const ids = db.prepare(`
    SELECT id FROM projects
    WHERE workspace_id = ? AND archived = 0 AND scan_enabled = 1 AND local_path IS NOT NULL
    ORDER BY id ASC
  `).all(workspaceId) as Array<{ id: number }>
  const results: Array<{ id: number; ok: boolean; project?: Record<string, unknown>; error?: string }> = []
  for (const row of ids) {
    if (Date.now() - startedAt > config.scanTimeoutMs) {
      results.push({ id: row.id, ok: false, error: 'Overall project scan timeout reached' })
      continue
    }
    try {
      results.push({ id: row.id, ok: true, project: await scanRegisteredProject(db, workspaceId, row.id, config) })
    } catch (error) {
      results.push({ id: row.id, ok: false, error: error instanceof Error ? error.message : 'Project scan failed' })
    }
  }
  return { results, durationMs: Date.now() - startedAt }
}

export function getProjectScanHistory(db: Database.Database, workspaceId: number, projectId: number) {
  return db.prepare(`
    SELECT id, status, duration_ms, git_json, health_json, error, created_at
    FROM project_scan_history
    WHERE workspace_id = ? AND project_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `).all(workspaceId, projectId).map((row: any) => ({
    ...row,
    git: row.git_json ? JSON.parse(row.git_json) : null,
    health: row.health_json ? JSON.parse(row.health_json) : null,
    git_json: undefined,
    health_json: undefined,
  }))
}

export function githubWebUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/\.git$/, '')
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed
  const ssh = trimmed.match(/^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
  return ssh ? `https://github.com/${ssh[1]}` : null
}

export function projectDisplayPath(value: string | null | undefined): string {
  return value ? path.normalize(value) : ''
}
