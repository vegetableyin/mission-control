import type { Project, Task } from '@/store'
import { projectInventorySortRank } from './project-health'

export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
export const STALE_PROJECT_DAYS = 14

export type OperatorAttentionKind = 'blocked' | 'failed' | 'waiting' | 'alert'

export function operatorAttentionSeverity(kind: OperatorAttentionKind): number {
  return { blocked: 4, failed: 3, waiting: 2, alert: 1 }[kind]
}

export type ProjectWithActivity = Project & {
  created_at?: number
  updated_at?: number
  unfinishedTasks: number
  failedTasks: number
  lastActivity: number | null
  blocked: boolean
  stale: boolean
}

export function epochMs(value?: number | null): number | null {
  if (!value || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1000 : value
}

export function shanghaiDayKey(value: number | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value instanceof Date ? value : new Date(value))
}

export function formatShanghaiDateTime(value?: number | null, locale = 'zh-CN'): string {
  const ms = epochMs(value)
  if (!ms) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone: SHANGHAI_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms)
}

export function isTaskToday(task: Task, now = Date.now()): boolean {
  const timestamp = epochMs(task.due_date) ?? epochMs(task.created_at)
  return timestamp ? shanghaiDayKey(timestamp) === shanghaiDayKey(now) : false
}

export function needsOperatorAttention(task: Task): boolean {
  return ['awaiting_owner', 'review', 'quality_review', 'failed'].includes(task.status)
}

export function isBlockedTask(task: Task): boolean {
  const metadata = task.metadata && !Array.isArray(task.metadata) && typeof task.metadata === 'object'
    ? task.metadata as Record<string, unknown>
    : null
  return metadata?.blocked === true || metadata?.status === 'blocked'
}

export function buildProjectStatus(
  projects: Project[],
  tasks: Task[],
  now = Date.now(),
): ProjectWithActivity[] {
  return projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id)
    const unfinished = projectTasks.filter((task) => task.status !== 'done')
    const failedTasks = projectTasks.filter((task) => task.status === 'failed').length
    const taskActivity = projectTasks
      .map((task) => epochMs(task.updated_at))
      .filter((value): value is number => value !== null)
    const projectActivity = epochMs(project.last_activity_at) ?? epochMs(project.updated_at)
    const gitActivity = epochMs(project.git_last_commit_at)
    const lastActivity = [projectActivity, gitActivity, ...taskActivity]
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0] ?? null
    const blocked = project.health_status === 'blocked' || ['blocked', 'error'].includes(project.status) || projectTasks.some(isBlockedTask)
    const monitored = !['completed', 'paused', 'archived'].includes(project.status)
    const staleDays = project.stale_after_days || STALE_PROJECT_DAYS
    const projectStaleBefore = now - staleDays * 24 * 60 * 60 * 1000
    return {
      ...project,
      unfinishedTasks: unfinished.length,
      failedTasks,
      lastActivity,
      blocked,
      stale: project.health_status === 'stale' || (monitored && Boolean(lastActivity && lastActivity < projectStaleBefore)),
    }
  }).sort((a, b) => {
    const rankA = projectInventorySortRank({ ...a, health_status: a.blocked ? 'blocked' : a.stale ? 'stale' : a.health_status })
    const rankB = projectInventorySortRank({ ...b, health_status: b.blocked ? 'blocked' : b.stale ? 'stale' : b.health_status })
    if (rankA !== rankB) return rankA - rankB
    if (a.failedTasks !== b.failedTasks) return b.failedTasks - a.failedTasks
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0)
  })
}
