import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { heavyLimiter } from '@/lib/rate-limit'
import { discoverLocalProjects } from '@/lib/project-discovery'
import { getProjectScanConfig } from '@/lib/project-scan-config'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    ensureTenantWorkspaceAccess(db, auth.user.tenant_id ?? 1, workspaceId, {
      actor: auth.user.username, actorId: auth.user.id, route: '/api/projects/discovery',
      ipAddress: (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
    })
    const registered = db.prepare(`SELECT local_path FROM projects WHERE workspace_id = ? AND local_path IS NOT NULL`).all(workspaceId) as Array<{ local_path: string }>
    const config = getProjectScanConfig()
    const result = await discoverLocalProjects(config, registered.map((row) => row.local_path))
    return NextResponse.json({ ...result, maxDepth: config.maxDepth, timeoutMs: config.scanTimeoutMs })
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error({ err: error }, 'GET /api/projects/discovery error')
    const message = error instanceof Error ? error.message : 'Project discovery failed'
    return NextResponse.json({ error: message }, { status: message.includes('timed out') ? 408 : 500 })
  }
}
