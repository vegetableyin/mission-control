import { spawn } from 'node:child_process'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { getProjectScanConfig, resolveAllowedProjectPath } from '@/lib/project-scan-config'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { logger } from '@/lib/logger'

function launchDirectory(target: string): void {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [target], { shell: false, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const projectId = Number.parseInt((await params).id, 10)
    if (!Number.isInteger(projectId) || projectId < 1) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    ensureTenantWorkspaceAccess(db, auth.user.tenant_id ?? 1, workspaceId, {
      actor: auth.user.username, actorId: auth.user.id, route: '/api/projects/[id]/open',
      ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
    })
    const project = db.prepare(`SELECT local_path FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as { local_path: string | null } | undefined
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!project.local_path) return NextResponse.json({ error: 'Project does not have a local path' }, { status: 400 })
    const resolved = await resolveAllowedProjectPath(project.local_path, getProjectScanConfig().roots)
    if (process.env.MISSION_CONTROL_TEST_MODE !== '1') launchDirectory(resolved)
    return NextResponse.json({ success: true, path: resolved, launched: process.env.MISSION_CONTROL_TEST_MODE !== '1' })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'POST /api/projects/[id]/open error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to open project directory' }, { status: 400 })
  }
}
