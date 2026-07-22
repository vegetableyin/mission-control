import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { createProjectInventorySchema, validateBody } from '@/lib/validation'
import { PROJECT_INVENTORY_COLUMNS, serializeProjectInventory, sortProjectInventory } from '@/lib/project-inventory'
import { getProjectScanConfig, normalizeProjectPath, resolveAllowedProjectPath } from '@/lib/project-scan-config'

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

function normalizePrefix(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function stableNameToken(input: string, length: number): string {
  return createHash('sha256').update(input.trim(), 'utf8').digest('hex').slice(0, length)
}

function normalizeStatus(status: string | undefined): string {
  return status === 'active' ? 'in_progress' : status || 'not_started'
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    ensureTenantWorkspaceAccess(db, auth.user.tenant_id ?? 1, workspaceId, {
      actor: auth.user.username, actorId: auth.user.id, route: '/api/projects',
      ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
    })
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1'
    const rows = db.prepare(`
      SELECT ${PROJECT_INVENTORY_COLUMNS},
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.workspace_id = p.workspace_id) AS task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.workspace_id = p.workspace_id AND t.status != 'done') AS unfinished_task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.workspace_id = p.workspace_id AND t.status = 'failed') AS failed_task_count,
             (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) AS assigned_agents_csv
      FROM projects p
      WHERE p.workspace_id = ? ${includeArchived ? '' : 'AND p.archived = 0'}
    `).all(workspaceId) as Array<Record<string, unknown>>
    const projects = sortProjectInventory(rows.map((row) => serializeProjectInventory({
      ...row,
      assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [],
      assigned_agents_csv: undefined,
    })) as Array<any>)
    return NextResponse.json({ projects })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'GET /api/projects error')
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    ensureTenantWorkspaceAccess(db, auth.user.tenant_id ?? 1, workspaceId, {
      actor: auth.user.username, actorId: auth.user.id, route: '/api/projects',
      ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
    })
    const validated = await validateBody(request, createProjectInventorySchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    const requestedSlug = body.slug ? slugify(body.slug) : slugify(body.name)
    const slug = requestedSlug || `project-${stableNameToken(body.name, 10)}`
    const requestedPrefix = normalizePrefix(String(body.ticket_prefix ?? body.ticketPrefix ?? body.name.slice(0, 5)))
    const ticketPrefix = requestedPrefix || `P${stableNameToken(body.name, 7).toUpperCase()}`

    const conflict = db.prepare(`SELECT id FROM projects WHERE workspace_id = ? AND (slug = ? OR ticket_prefix = ?) LIMIT 1`)
      .get(workspaceId, slug, ticketPrefix)
    if (conflict) return NextResponse.json({ error: 'Project slug or ticket prefix already exists' }, { status: 409 })

    let localPath: string | null = null
    if (body.local_path) {
      try {
        localPath = await resolveAllowedProjectPath(body.local_path, getProjectScanConfig().roots)
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid local path' }, { status: 400 })
      }
      const existingPaths = db.prepare(`SELECT local_path FROM projects WHERE workspace_id = ? AND local_path IS NOT NULL`).all(workspaceId) as Array<{ local_path: string }>
      if (existingPaths.some((row) => normalizeProjectPath(row.local_path) === normalizeProjectPath(localPath!))) {
        return NextResponse.json({ error: 'Project path is already registered' }, { status: 409 })
      }
    }
    const status = normalizeStatus(body.status)
    const archived = body.archived || status === 'archived' ? 1 : 0
    const repository = body.github_repository || body.github_repo || null
    const staleDays = body.stale_after_days || getProjectScanConfig().defaultStaleDays
    const result = db.prepare(`
      INSERT INTO projects (
        workspace_id, name, slug, description, ticket_prefix, github_repo, github_repository,
        deadline, color, status, project_type, local_path, owner, customer, stage,
        priority, next_action, blocker, archived, scan_enabled, stale_after_days,
        health_status, created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', unixepoch(), unixepoch(), unixepoch())
    `).run(
      workspaceId, body.name, slug, body.description?.trim() || null, ticketPrefix, repository, repository,
      body.deadline ?? null, body.color || null, status, body.project_type || 'other', localPath,
      body.owner || null, body.customer || null, body.stage || null, body.priority || 'medium',
      body.next_action || null, body.blocker || null, archived, body.scan_enabled === false || body.scan_enabled === 0 ? 0 : 1, staleDays,
    )
    const row = db.prepare(`SELECT ${PROJECT_INVENTORY_COLUMNS} FROM projects p WHERE p.id = ?`).get(Number(result.lastInsertRowid)) as Record<string, unknown>
    return NextResponse.json({ project: serializeProjectInventory(row) }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'POST /api/projects error')
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
