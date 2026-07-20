'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { formatShanghaiDateTime, isBlockedTask } from '@/lib/command-center'
import type { CronJob, Task } from '@/store'
import { Button } from '@/components/ui/button'

interface AlertRule {
  id: number
  name: string
  enabled: number
  entity_type: string
  trigger_count: number
  last_triggered_at?: number | null
}

interface Approval {
  id: string
  command?: string
  toolName?: string
  createdAt?: number
  status?: string
}

interface AttentionItem {
  id: string
  kind: 'approval' | 'failed' | 'blocked' | 'security' | 'schedule'
  title: string
  detail: string
  timestamp?: number | null
  panel: string
}

const storageKey = 'mission-control.attention.dismissed.v1'

export function AttentionCenterPanel() {
  const t = useTranslations('attentionCenter')
  const navigate = useNavigateToPanel()
  const [tasks, setTasks] = useState<Task[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [dismissed, setDismissed] = useState<Record<string, 'handled' | 'ignored'>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try { setDismissed(JSON.parse(localStorage.getItem(storageKey) || '{}')) } catch { setDismissed({}) }
  }, [])

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch<{ tasks?: Task[] }>('/api/tasks?limit=200'),
      apiFetch<{ rules?: AlertRule[] }>('/api/alerts'),
      apiFetch<{ jobs?: CronJob[] }>('/api/cron?action=list'),
      apiFetch<{ requests?: Approval[]; approvals?: Approval[] }>('/api/exec-approvals'),
    ])
    setTasks(results[0].status === 'fulfilled' ? results[0].value.tasks || [] : [])
    setRules(results[1].status === 'fulfilled' ? results[1].value.rules || [] : [])
    setJobs(results[2].status === 'fulfilled' ? results[2].value.jobs || [] : [])
    setApprovals(results[3].status === 'fulfilled' ? results[3].value.requests || results[3].value.approvals || [] : [])
    setLoading(false)
  }, [])
  useSmartPoll(load, 30_000)

  const allItems = useMemo<AttentionItem[]>(() => [
    ...approvals.filter((approval) => !approval.status || approval.status === 'pending').map((approval) => ({ id: `approval-${approval.id}`, kind: 'approval' as const, title: approval.command || approval.toolName || t('approval'), detail: t('approvalDetail'), timestamp: approval.createdAt, panel: 'exec-approvals' })),
    ...tasks.filter((task) => ['awaiting_owner', 'review', 'quality_review'].includes(task.status)).map((task) => ({ id: `task-waiting-${task.id}`, kind: 'approval' as const, title: task.title, detail: t('waitingTaskDetail'), timestamp: task.updated_at, panel: 'tasks' })),
    ...tasks.filter((task) => task.status === 'failed').map((task) => ({ id: `task-failed-${task.id}`, kind: 'failed' as const, title: task.title, detail: task.error_message || t('failedTaskDetail'), timestamp: task.updated_at, panel: 'tasks' })),
    ...tasks.filter(isBlockedTask).map((task) => ({ id: `task-blocked-${task.id}`, kind: 'blocked' as const, title: task.title, detail: t('blockedTaskDetail'), timestamp: task.updated_at, panel: 'tasks' })),
    ...rules.filter((rule) => rule.enabled && rule.trigger_count > 0).map((rule) => ({ id: `alert-${rule.id}`, kind: 'security' as const, title: rule.name, detail: rule.entity_type === 'security' ? t('securityAlertDetail') : t('alertDetail', { count: rule.trigger_count }), timestamp: rule.last_triggered_at, panel: rule.entity_type === 'security' ? 'security' : 'alerts' })),
    ...jobs.filter((job) => job.lastStatus === 'error').map((job) => ({ id: `schedule-${job.id || job.name}`, kind: 'schedule' as const, title: job.name, detail: job.lastError || t('scheduleFailureDetail'), timestamp: job.lastRun, panel: 'cron' })),
  ].sort((a, b) => severity(b.kind) - severity(a.kind) || Number(b.timestamp || 0) - Number(a.timestamp || 0)), [approvals, jobs, rules, tasks, t])

  const visibleItems = allItems.filter((item) => !dismissed[item.id])
  const dismissedItems = allItems.filter((item) => dismissed[item.id])

  const updateDismissed = (id: string, state: 'handled' | 'ignored' | null) => {
    const next = { ...dismissed }
    if (state) next[id] = state
    else delete next[id]
    setDismissed(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6 space-y-5">
      <div><h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('description')}</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{(['approval', 'failed', 'blocked', 'security', 'schedule'] as const).map((kind) => <div key={kind} className="rounded-xl border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{t(`kind.${kind}`)}</div><div className={`mt-2 text-2xl font-semibold tabular-nums ${['failed', 'blocked'].includes(kind) ? 'text-red-400' : kind === 'approval' ? 'text-amber-400' : 'text-foreground'}`}>{visibleItems.filter((item) => item.kind === kind).length}</div></div>)}</div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{t('openItems')}</h2></div>
        {loading ? <p className="p-8 text-center text-sm text-muted-foreground">{t('loading')}</p> : visibleItems.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">{t('empty')}</p> : <div className="divide-y divide-border/60">{visibleItems.map((item) => <div key={item.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone(item.kind)}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{t(`kind.${item.kind}`)}</span>{item.timestamp && <span className="text-[11px] text-muted-foreground/70">{formatShanghaiDateTime(item.timestamp)}</span>}</div><div className="mt-1 font-medium text-foreground">{item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.detail}</div></div></div><div className="flex shrink-0 flex-wrap gap-2 pl-5 md:pl-0"><Button size="xs" variant="outline" onClick={() => navigate(item.panel)}>{t('viewDetails')}</Button><Button size="xs" variant="ghost" onClick={() => updateDismissed(item.id, 'handled')}>{t('markHandled')}</Button><Button size="xs" variant="ghost" onClick={() => updateDismissed(item.id, 'ignored')}>{t('ignore')}</Button></div></div>)}</div>}
      </div>
      {dismissedItems.length > 0 && <details className="rounded-xl border border-border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm text-muted-foreground">{t('dismissed', { count: dismissedItems.length })}</summary><div className="divide-y divide-border/60 border-t border-border">{dismissedItems.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="truncate text-muted-foreground">{item.title}</span><button onClick={() => updateDismissed(item.id, null)} className="shrink-0 text-xs text-primary hover:underline">{t('restore')}</button></div>)}</div></details>}
      <p className="text-xs text-muted-foreground">{t('localStateNote')}</p>
    </div>
  )
}

function severity(kind: AttentionItem['kind']): number { return { blocked: 5, failed: 4, approval: 3, security: 2, schedule: 1 }[kind] }
function tone(kind: AttentionItem['kind']): string { return kind === 'failed' || kind === 'blocked' ? 'bg-red-400' : kind === 'approval' ? 'bg-amber-400' : 'bg-primary' }
