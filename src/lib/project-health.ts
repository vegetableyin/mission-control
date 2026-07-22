import type { GitProjectMetadata } from './project-git'

export type ProjectLifecycleStatus = 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'review' | 'completed' | 'paused' | 'archived'
export type ProjectHealthStatus = 'healthy' | 'attention' | 'blocked' | 'stale' | 'unknown'

export interface ProjectHealthReason {
  code: string
  deduction: number
  detail?: string | number | null
}

export interface ProjectHealthInput {
  status: ProjectLifecycleStatus | string
  localPath?: string | null
  directoryExists?: boolean | null
  directoryEntryCount?: number | null
  nextAction?: string | null
  staleAfterDays: number
  lastActivityAt?: number | null
  dirtySinceAt?: number | null
  git?: GitProjectMetadata | null
  recentFailedTasks: number
  attentionTasks: number
  now?: number
}

export interface ProjectHealthResult {
  score: number | null
  status: ProjectHealthStatus
  reasons: ProjectHealthReason[]
}

const DAY_SECONDS = 86_400
const inactiveStatuses = new Set(['completed', 'paused', 'archived'])

export function calculateProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  const now = Math.floor((input.now ?? Date.now()) / 1000)
  if (!input.localPath && !input.git && input.recentFailedTasks === 0 && input.attentionTasks === 0) {
    return { score: null, status: input.status === 'blocked' ? 'blocked' : 'unknown', reasons: [{ code: 'insufficient_data', deduction: 0 }] }
  }

  let score = 100
  const reasons: ProjectHealthReason[] = []
  const deduct = (code: string, deduction: number, detail?: string | number | null) => {
    score -= deduction
    reasons.push({ code, deduction, detail })
  }
  let hardBlocked = false
  let stale = false

  if (input.localPath && input.directoryExists === false) {
    deduct('directory_missing', 100, input.localPath)
    hardBlocked = true
  }
  if (input.git?.error) deduct(input.git.timedOut ? 'git_timeout' : 'git_failed', 30, input.git.error)
  if (input.status === 'blocked') {
    deduct('status_blocked', 40)
    hardBlocked = true
  }
  if (!inactiveStatuses.has(input.status)) {
    if (input.lastActivityAt && now - input.lastActivityAt > input.staleAfterDays * DAY_SECONDS) {
      deduct('stale_activity', 25, input.staleAfterDays)
      stale = true
    }
    if (input.git?.lastCommitAt && now - input.git.lastCommitAt > 30 * DAY_SECONDS) {
      deduct('old_commit', 20, 30)
    }
  }
  if (input.git?.dirty && input.dirtySinceAt && now - input.dirtySinceAt > 7 * DAY_SECONDS) deduct('dirty_too_long', 15, 7)
  if (input.git?.detachedHead) deduct('detached_head', 15)
  if (!inactiveStatuses.has(input.status) && !input.nextAction?.trim()) deduct('missing_next_action', 10)
  if (input.status === 'in_progress' && input.directoryEntryCount === 0) deduct('empty_in_progress_directory', 30)
  if (input.recentFailedTasks > 0) deduct('recent_failed_tasks', 20, input.recentFailedTasks)
  if (input.attentionTasks > 0) deduct('attention_required', 15, input.attentionTasks)

  score = Math.max(0, Math.min(100, score))
  if (hardBlocked) return { score, status: 'blocked', reasons }
  if (score >= 80) return { score, status: 'healthy', reasons }
  if (score >= 60) return { score, status: 'attention', reasons }
  return { score, status: stale ? 'stale' : 'blocked', reasons }
}

export function projectInventorySortRank(project: { status: string; health_status?: string | null; archived?: number | boolean }): number {
  if (project.archived || project.status === 'archived') return 80
  if (project.status === 'blocked' || project.health_status === 'blocked') return 0
  if (project.health_status === 'attention') return 10
  if (project.health_status === 'stale') return 20
  return ({ in_progress: 30, waiting: 40, not_started: 45, review: 50, paused: 60, completed: 70 } as Record<string, number>)[project.status] ?? 55
}
