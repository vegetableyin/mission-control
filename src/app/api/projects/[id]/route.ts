import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { updateProjectSchema, validateBody } from '@/lib/validation'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { getProjectScanHistory, PROJECT_INVENTORY_COLUMNS, serializeProjectInventory } from '@/lib/project-inventory'
import { getProjectScanConfig, normalizeProjectPath, resolveAllowedProjectPath } from '@/lib/project-scan-config'

function normalizePrefix(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function toProjectId(raw: string): number {
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) ? id : NaN
}

type ProjectScope =
  | { error: string; status: number }
  | { notFound: true }
  | { db: ReturnType<typeof getDatabase>; workspaceId: number }

function scopeProject(request: NextRequest, role: 'viewer' | 'operator' | 'admin', projectId: number): ProjectScope {
  const auth = requireRole(request, role)
  if ('error' in auth) return { error: auth.error || 'Unauthorized', status: auth.status || 401 }
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const tenantId = auth.user.tenant_id ?? 1
  ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
    actor: auth.user.username, actorId: auth.user.id, route: '/api/projects/[id]',
    ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
    userAgent: request.headers.get('user-agent'),
  })
  const scoped = db.prepare(`
    SELECT p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ? LIMIT 1
  `).get(projectId, workspaceId, tenantId)
  if (!scoped) return { notFound: true as const }
  return { db, workspaceId }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const projectId = toProjectId((await params).id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const scope = scopeProject(request, 'viewer', projectId)
    if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if ('notFound' in scope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const { db, workspaceId } = scope
    const row = db.prepare(`
      SELECT ${PROJECT_INVENTORY_COLUMNS},
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.workspace_id = p.workspace_id) AS task_count,
        (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) AS assigned_agents_csv
      FROM projects p WHERE p.id = ? AND p.workspace_id = ?
    `).get(projectId, workspaceId) as Record<string, unknown>
    const tasks = db.prepare(`
      SELECT id, title, status, priority, updated_at, created_at, error_message
      FROM tasks WHERE workspace_id = ? AND project_id = ?
      ORDER BY updated_at DESC LIMIT 50
    `).all(workspaceId, projectId)
    const project = serializeProjectInventory({
      ...row,
      assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [],
      assigned_agents_csv: undefined,
    })
    return NextResponse.json({ project, tasks, scan_history: getProjectScanHistory(db, workspaceId, projectId) })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'GET /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const projectId = toProjectId((await params).id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const scope = scopeProject(request, 'operator', projectId)
    if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if ('notFound' in scope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const rateCheck = mutationLimiter(request)
    if (rateCheck) return rateCheck
    const { db, workspaceId } = scope
    const current = db.prepare(`SELECT id, slug, local_path, status, archived FROM projects WHERE id = ? AND workspace_id = ?`)
      .get(projectId, workspaceId) as { id: number; slug: string; local_path: string | null; status: string; archived: number }
    const validated = await validateBody(request, updateProjectSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    const normalizedStatus = body.status === 'active' ? 'in_progress' : body.status
    if (current.slug === 'general' && (normalizedStatus === 'archived' || body.archived === true || body.archived === 1)) {
      return NextResponse.json({ error: 'Default project cannot be archived' }, { status: 400 })
    }

    const updates: string[] = []
    const values: Array<string | number | null> = []
    const set = (column: string, value: string | number | null) => { updates.push(`${column} = ?`); values.push(value) }
    if (body.name !== undefined) set('name', body.name)
    if (body.description !== undefined) set('description', body.description?.trim() || null)
    if (body.ticket_prefix !== undefined || body.ticketPrefix !== undefined) {
      const prefix = normalizePrefix(String(body.ticket_prefix ?? body.ticketPrefix))
      if (!prefix) return NextResponse.json({ error: 'Invalid ticket prefix' }, { status: 400 })
      const conflict = db.prepare(`SELECT id FROM projects WHERE workspace_id = ? AND ticket_prefix = ? AND id != ?`).get(workspaceId, prefix, projectId)
      if (conflict) return NextResponse.json({ error: 'Ticket prefix already in use' }, { status: 409 })
      set('ticket_prefix', prefix)
    }
    if (normalizedStatus !== undefined) {
      set('status', normalizedStatus)
      set('archived', normalizedStatus === 'archived' ? 1 : 0)
    }
    if (body.archived !== undefined) {
      const archived = body.archived === true || body.archived === 1
      set('archived', archived ? 1 : 0)
      set('status', archived ? 'archived' : (normalizedStatus || (current.status === 'archived' ? 'paused' : current.status)))
    }
    const repository = body.github_repository !== undefined ? body.github_repository : body.github_repo
    if (repository !== undefined) {
      set('github_repository', repository || null)
      set('github_repo', repository || null)
    }
    if (body.deadline !== undefined) set('deadline', body.deadline)
    if (body.color !== undefined) set('color', body.color || null)
    if (body.github_sync_enabled !== undefined) set('github_sync_enabled', body.github_sync_enabled ? 1 : 0)
    if (body.github_default_branch !== undefined) set('github_default_branch', body.github_default_branch)
    if (body.github_labels_initialized !== undefined) set('github_labels_initialized', body.github_labels_initialized ? 1 : 0)
    for (const field of ['project_type', 'owner', 'customer', 'stage', 'priority', 'next_action', 'blocker', 'health_status'] as const) {
      if (body[field] !== undefined) set(field, body[field] || null)
    }
    if (body.health_score !== undefined) set('health_score', body.health_score)
    if (body.scan_enabled !== undefined) set('scan_enabled', body.scan_enabled ? 1 : 0)
    if (body.stale_after_days !== undefined) set('stale_after_days', body.stale_after_days)
    if (body.local_path !== undefined) {
      let localPath: string | null = null
      if (body.local_path) {
        try { localPath = await resolveAllowedProjectPath(body.local_path, getProjectScanConfig().roots) }
        catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid local path' }, { status: 400 }) }
        const existing = db.prepare(`SELECT id, local_path FROM projects WHERE workspace_id = ? AND id != ? AND local_path IS NOT NULL`).all(workspaceId, projectId) as Array<{ id: number; local_path: string }>
        if (existing.some((row) => normalizeProjectPath(row.local_path) === normalizeProjectPath(localPath!))) {
          return NextResponse.json({ error: 'Project path is already registered' }, { status: 409 })
        }
      }
      set('local_path', localPath)
      if (localPath !== current.local_path) {
        set('health_status', 'unknown')
        set('health_score', null)
        set('last_scan_at', null)
      }
    }

    const assignedAgents = body.assigned_agents
    const existingAssignmentRoles = new Map<string, string>()
    if (assignedAgents?.length) {
      const placeholders = assignedAgents.map(() => '?').join(', ')
      const known = db.prepare(`SELECT name FROM agents WHERE workspace_id = ? AND name IN (${placeholders})`).all(workspaceId, ...assignedAgents) as Array<{ name: string }>
      const knownNames = new Set(known.map((agent) => agent.name))
      const unknown = assignedAgents.filter((name) => !knownNames.has(name))
      if (unknown.length) return NextResponse.json({ error: 'Unknown project agents', details: unknown }, { status: 400 })
      const existingAssignments = db.prepare(`
        SELECT agent_name, role FROM project_agent_assignments
        WHERE project_id = ? AND agent_name IN (${placeholders})
      `).all(projectId, ...assignedAgents) as Array<{ agent_name: string; role: string }>
      for (const assignment of existingAssignments) existingAssignmentRoles.set(assignment.agent_name, assignment.role)
    }
    updates.push('updated_at = unixepoch()', 'last_activity_at = unixepoch()')
    db.transaction(() => {
      db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values, projectId, workspaceId)
      if (assignedAgents !== undefined) {
        db.prepare(`DELETE FROM project_agent_assignments WHERE project_id = ?`).run(projectId)
        const insert = db.prepare(`INSERT OR IGNORE INTO project_agent_assignments (project_id, agent_name, role) VALUES (?, ?, ?)`)
        for (const name of assignedAgents) insert.run(projectId, name, existingAssignmentRoles.get(name) || 'member')
      }
    })()
    const row = db.prepare(`
      SELECT ${PROJECT_INVENTORY_COLUMNS},
        (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) AS assigned_agents_csv
      FROM projects p WHERE p.id = ? AND p.workspace_id = ?
    `).get(projectId, workspaceId) as Record<string, unknown>
    return NextResponse.json({
      project: serializeProjectInventory({
        ...row,
        assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [],
        assigned_agents_csv: undefined,
      }),
    })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'PATCH /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const projectId = toProjectId((await params).id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const scope = scopeProject(request, 'admin', projectId)
    if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if ('notFound' in scope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const rateCheck = mutationLimiter(request)
    if (rateCheck) return rateCheck
    const { db, workspaceId } = scope
    const current = db.prepare(`SELECT slug FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { slug: string }
    if (current.slug === 'general') return NextResponse.json({ error: 'Default project cannot be deleted' }, { status: 400 })
    const mode = new URL(request.url).searchParams.get('mode') || 'archive'
    if (mode !== 'delete') {
      db.prepare(`UPDATE projects SET status = 'archived', archived = 1, updated_at = unixepoch(), last_activity_at = unixepoch() WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId)
      return NextResponse.json({ success: true, mode: 'archive' })
    }
    const fallback = db.prepare(`SELECT id FROM projects WHERE workspace_id = ? AND slug = 'general' LIMIT 1`).get(workspaceId) as { id: number } | undefined
    if (!fallback) return NextResponse.json({ error: 'Default project missing' }, { status: 500 })
    db.transaction(() => {
      db.prepare(`UPDATE tasks SET project_id = ? WHERE workspace_id = ? AND project_id = ?`).run(fallback.id, workspaceId, projectId)
      db.prepare(`DELETE FROM projects WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId)
    })()
    return NextResponse.json({ success: true, mode: 'delete' })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'DELETE /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
