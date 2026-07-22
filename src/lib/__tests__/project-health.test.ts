import { describe, expect, it } from 'vitest'
import { calculateProjectHealth, projectInventorySortRank } from '@/lib/project-health'
import type { GitProjectMetadata } from '@/lib/project-git'

const now = Date.UTC(2026, 6, 22)
const day = 86_400
const git = (patch: Partial<GitProjectMetadata> = {}): GitProjectMetadata => ({
  isGit: true, accessible: true, branch: 'main', headSha: 'a'.repeat(40), lastCommitAt: Math.floor(now / 1000),
  lastCommitTitle: 'ok', dirty: false, modifiedCount: 0, untrackedCount: 0, aheadCount: 0, behindCount: 0,
  detachedHead: false, hasOrigin: true, originUrl: 'https://github.com/example/repo.git', upstream: 'origin/main',
  error: null, timedOut: false, ...patch,
})

describe('explainable project health', () => {
  it('returns healthy with no deductions for a current project', () => {
    expect(calculateProjectHealth({ status: 'in_progress', localPath: 'D:\\Work\\demo', directoryExists: true, directoryEntryCount: 2, nextAction: 'Ship', staleAfterDays: 7, lastActivityAt: Math.floor(now / 1000), git: git(), recentFailedTasks: 0, attentionTasks: 0, now })).toEqual({ score: 100, status: 'healthy', reasons: [] })
  })

  it('makes missing directories and manual blocks authoritative', () => {
    const missing = calculateProjectHealth({ status: 'in_progress', localPath: 'D:\\Work\\missing', directoryExists: false, nextAction: '', staleAfterDays: 7, recentFailedTasks: 0, attentionTasks: 0, now })
    expect(missing.status).toBe('blocked')
    expect(missing.reasons.map((reason) => reason.code)).toContain('directory_missing')
    expect(calculateProjectHealth({ status: 'blocked', localPath: 'D:\\Work\\demo', directoryExists: true, directoryEntryCount: 1, nextAction: 'Wait', staleAfterDays: 7, git: git(), recentFailedTasks: 0, attentionTasks: 0, now }).status).toBe('blocked')
  })

  it('records every deterministic deduction', () => {
    const result = calculateProjectHealth({
      status: 'in_progress', localPath: 'D:\\Work\\demo', directoryExists: true, directoryEntryCount: 0,
      nextAction: '', staleAfterDays: 7, lastActivityAt: Math.floor(now / 1000) - 10 * day,
      dirtySinceAt: Math.floor(now / 1000) - 8 * day,
      git: git({ dirty: true, detachedHead: true, lastCommitAt: Math.floor(now / 1000) - 31 * day }),
      recentFailedTasks: 1, attentionTasks: 2, now,
    })
    expect(result.score).toBe(0)
    expect(result.status).toBe('stale')
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['stale_activity', 'old_commit', 'dirty_too_long', 'detached_head', 'missing_next_action', 'empty_in_progress_directory', 'recent_failed_tasks', 'attention_required']))
  })

  it.each(['paused', 'completed', 'archived'])('%s projects do not become stale because of inactivity', (status) => {
    const result = calculateProjectHealth({ status, localPath: 'D:\\Work\\demo', directoryExists: true, directoryEntryCount: 1, nextAction: '', staleAfterDays: 7, lastActivityAt: Math.floor(now / 1000) - 90 * day, git: git({ lastCommitAt: Math.floor(now / 1000) - 90 * day }), recentFailedTasks: 0, attentionTasks: 0, now })
    expect(result.reasons.map((reason) => reason.code)).not.toEqual(expect.arrayContaining(['stale_activity', 'old_commit']))
  })

  it('sorts project exceptions before routine lifecycle states', () => {
    const ordered = [
      { status: 'archived', health_status: 'unknown' }, { status: 'in_progress', health_status: 'healthy' },
      { status: 'waiting', health_status: 'healthy' }, { status: 'in_progress', health_status: 'stale' },
      { status: 'in_progress', health_status: 'attention' }, { status: 'blocked', health_status: 'blocked' },
    ].sort((a, b) => projectInventorySortRank(a) - projectInventorySortRank(b))
    expect(ordered.map((project) => project.health_status)).toEqual(['blocked', 'attention', 'stale', 'healthy', 'healthy', 'unknown'])
  })
})
