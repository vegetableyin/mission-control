import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { scanAllRegisteredProjects, scanRegisteredProject } from '@/lib/project-inventory'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    ensureTenantWorkspaceAccess(db, auth.user.tenant_id ?? 1, workspaceId, {
      actor: auth.user.username, actorId: auth.user.id, route: '/api/projects/scan',
      ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
    })
    const body = await request.json().catch(() => ({})) as { projectId?: unknown }
    if (body.projectId !== undefined) {
      const projectId = Number(body.projectId)
      if (!Number.isInteger(projectId) || projectId < 1) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
      try {
        return NextResponse.json({ project: await scanRegisteredProject(db, workspaceId, projectId) })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Project scan failed'
        const status = message === 'Project not found' ? 404 : message.includes('disabled') ? 409 : 400
        return NextResponse.json({ error: message }, { status })
      }
    }
    return NextResponse.json(await scanAllRegisteredProjects(db, workspaceId))
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'POST /api/projects/scan error')
    return NextResponse.json({ error: 'Project scan failed' }, { status: 500 })
  }
}
