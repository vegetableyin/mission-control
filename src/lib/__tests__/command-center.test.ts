import { describe, expect, it } from 'vitest'
import { buildProjectStatus, isBlockedTask, isTaskToday, shanghaiDayKey } from '@/lib/command-center'
import type { Project, Task } from '@/store'

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: 'Task',
    status: 'in_progress',
    priority: 'medium',
    created_by: 'test',
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    ...overrides,
  }
}

describe('command center selectors', () => {
  it('sorts blocked and failed projects before healthy projects', () => {
    const projects: Project[] = [
      { id: 1, name: 'Healthy', slug: 'healthy', ticket_prefix: 'H', status: 'active' },
      { id: 2, name: 'Failed', slug: 'failed', ticket_prefix: 'F', status: 'active' },
      { id: 3, name: 'Blocked', slug: 'blocked', ticket_prefix: 'B', status: 'active' },
    ]
    const rows = buildProjectStatus(projects, [
      task({ id: 2, project_id: 2, status: 'failed' }),
      task({ id: 3, project_id: 3, metadata: { blocked: true } }),
    ], 1_700_000_000_000)

    expect(rows.map((row) => row.name)).toEqual(['Blocked', 'Failed', 'Healthy'])
    expect(rows[0].blocked).toBe(true)
    expect(rows[1].failedTasks).toBe(1)
  })

  it('does not invent a block when task metadata has no block marker', () => {
    expect(isBlockedTask(task({ metadata: { note: 'ordinary task' } }))).toBe(false)
  })

  it('uses Asia/Shanghai when deciding whether a task belongs to today', () => {
    const now = Date.parse('2026-07-20T16:30:00.000Z')
    const due = Date.parse('2026-07-20T16:05:00.000Z') / 1000
    expect(shanghaiDayKey(now)).toBe('2026-07-21')
    expect(isTaskToday(task({ due_date: due }), now)).toBe(true)
  })
})

