'use client'

import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { Activity, CronJob, Project, Session, Task } from '@/store'
import {
  buildProjectStatus,
  formatShanghaiDateTime,
  isBlockedTask,
  isTaskToday,
} from '@/lib/command-center'

interface AlertRule {
  id: number
  name: string
  enabled: number
  trigger_count: number
  last_triggered_at?: number | null
}

interface DashboardState {
  projects: Project[]
  tasks: Task[]
  sessions: Session[]
  activities: Activity[]
  jobs: CronJob[]
  rules: AlertRule[]
}

const emptyState: DashboardState = { projects: [], tasks: [], sessions: [], activities: [], jobs: [], rules: [] }

function MetricCard({ label, value, tone, onClick }: { label: string; value: number; tone?: 'danger' | 'warn'; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-foreground'}`}>{value}</div>
    </button>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EssentialDashboard() {
  const t = useTranslations('essentialDashboard')
  const locale = useLocale() === 'zh' ? 'zh-CN' : 'en-US'
  const navigate = useNavigateToPanel()
  const [data, setData] = useState<DashboardState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch<{ projects?: Project[] }>('/api/projects?includeArchived=1'),
      apiFetch<{ tasks?: Task[] }>('/api/tasks?limit=200'),
      apiFetch<{ sessions?: Session[] }>('/api/sessions'),
      apiFetch<{ activities?: Activity[] }>('/api/activities?limit=12'),
      apiFetch<{ jobs?: CronJob[] }>('/api/cron?action=list'),
      apiFetch<{ rules?: AlertRule[] }>('/api/alerts'),
    ])
    setData({
      projects: results[0].status === 'fulfilled' ? results[0].value.projects || [] : [],
      tasks: results[1].status === 'fulfilled' ? results[1].value.tasks || [] : [],
      sessions: results[2].status === 'fulfilled' ? results[2].value.sessions || [] : [],
      activities: results[3].status === 'fulfilled' ? results[3].value.activities || [] : [],
      jobs: results[4].status === 'fulfilled' ? results[4].value.jobs || [] : [],
      rules: results[5].status === 'fulfilled' ? results[5].value.rules || [] : [],
    })
    setLoadError(results.every((result) => result.status === 'rejected'))
    setLoading(false)
  }, [])

  useSmartPoll(load, 30_000)

  const view = useMemo(() => {
    const projects = buildProjectStatus(data.projects, data.tasks)
    const activeProjects = projects.filter((project) => project.status === 'active')
    const todayTasks = data.tasks.filter((task) => isTaskToday(task))
    const failedTasks = data.tasks.filter((task) => task.status === 'failed')
    const blockedTasks = data.tasks.filter(isBlockedTask)
    const waitingTasks = data.tasks.filter((task) => ['awaiting_owner', 'review', 'quality_review'].includes(task.status))
    const activeAlerts = data.rules.filter((rule) => rule.enabled && rule.trigger_count > 0)
    const codexSessions = data.sessions.filter((session) => session.kind.toLowerCase().includes('codex'))
    const attention = [
      ...waitingTasks.map((task) => ({ id: `waiting-${task.id}`, tone: 'warn' as const, label: t('waitingTask'), title: task.title, panel: 'tasks' })),
      ...failedTasks.map((task) => ({ id: `failed-${task.id}`, tone: 'danger' as const, label: t('failedTask'), title: task.title, panel: 'tasks' })),
      ...blockedTasks.map((task) => ({ id: `blocked-${task.id}`, tone: 'danger' as const, label: t('blockedTask'), title: task.title, panel: 'tasks' })),
      ...activeAlerts.map((rule) => ({ id: `alert-${rule.id}`, tone: 'warn' as const, label: t('alert'), title: rule.name, panel: 'alerts' })),
    ].slice(0, 8)
    return { projects, activeProjects, todayTasks, failedTasks, blockedTasks, waitingTasks, activeAlerts, codexSessions, attention }
  }, [data, t])

  const todayKey = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const jobsRunToday = data.jobs.filter((job) => job.lastRun && isSameShanghaiDay(job.lastRun)).length
  const jobsFailedToday = data.jobs.filter((job) => job.lastStatus === 'error' && job.lastRun && isSameShanghaiDay(job.lastRun)).length
  const nextJob = data.jobs.filter((job) => job.enabled && job.nextRun).sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0))[0]
  const pausedJobs = data.jobs.filter((job) => !job.enabled).length
  const codexRecentCompleted = view.codexSessions.filter((session) => !session.active).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).slice(0, 3)

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs text-primary">{todayKey}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {loadError && <span className="mt-2 text-xs text-red-400">{t('loadError')}</span>}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label={t('metrics.activeProjects')} value={view.activeProjects.length} onClick={() => navigate('projects')} />
        <MetricCard label={t('metrics.blockedProjects')} value={view.projects.filter((project) => project.blocked).length} tone="danger" onClick={() => navigate('projects')} />
        <MetricCard label={t('metrics.todayTasks')} value={view.todayTasks.length} onClick={() => navigate('tasks')} />
        <MetricCard label={t('metrics.failedTasks')} value={view.failedTasks.length} tone="danger" onClick={() => navigate('tasks')} />
        <MetricCard label={t('metrics.waiting')} value={view.waitingTasks.length} tone="warn" onClick={() => navigate('attention')} />
        <MetricCard label={t('metrics.staleProjects')} value={view.projects.filter((project) => project.stale).length} tone="warn" onClick={() => navigate('projects')} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1.9fr]">
        <Section title={t('attention.title')} action={<button onClick={() => navigate('attention')} className="text-xs text-primary hover:underline">{t('viewAll')}</button>}>
          {loading ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : view.attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('attention.empty')}</p>
          ) : (
            <div className="space-y-2">
              {view.attention.map((item) => (
                <button key={item.id} onClick={() => navigate(item.panel)} className="flex w-full items-start gap-3 rounded-lg border border-border/70 p-3 text-left hover:bg-secondary/50">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.tone === 'danger' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="min-w-0"><span className="block text-[11px] text-muted-foreground">{item.label}</span><span className="block truncate text-sm text-foreground">{item.title}</span></span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('projects.title')} action={<button onClick={() => navigate('projects')} className="text-xs text-primary hover:underline">{t('viewAll')}</button>}>
          {loading ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : view.projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('projects.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="text-muted-foreground"><tr><th className="pb-3 font-medium">{t('projects.name')}</th><th className="pb-3 font-medium">{t('projects.status')}</th><th className="pb-3 font-medium">{t('projects.lastActivity')}</th><th className="pb-3 text-right font-medium">{t('projects.open')}</th><th className="pb-3 text-right font-medium">{t('projects.failed')}</th><th /></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {view.projects.slice(0, 8).map((project) => (
                    <tr key={project.id} className="group">
                      <td className="py-3 font-medium text-foreground">{project.name}</td>
                      <td className="py-3"><span className={project.blocked ? 'text-red-400' : project.stale ? 'text-amber-400' : 'text-emerald-400'}>{project.blocked ? t('status.blocked') : project.stale ? t('status.stale') : t(`status.${project.status === 'active' ? 'active' : 'inactive'}`)}</span></td>
                      <td className="py-3 text-muted-foreground">{formatShanghaiDateTime(project.lastActivity, locale)}</td>
                      <td className="py-3 text-right tabular-nums">{project.unfinishedTasks}</td>
                      <td className={`py-3 text-right tabular-nums ${project.failedTasks ? 'text-red-400' : 'text-muted-foreground'}`}>{project.failedTasks}</td>
                      <td className="py-3 text-right"><button onClick={() => navigate('tasks')} className="text-primary opacity-80 hover:underline group-hover:opacity-100">{t('projects.next')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={t('codex.title')} action={<button onClick={() => navigate('codex')} className="text-xs text-primary hover:underline">{t('viewAll')}</button>}>
          <div className="grid grid-cols-2 gap-3 text-sm"><Stat label={t('codex.running')} value={view.codexSessions.filter((session) => session.active).length} /><Stat label={t('codex.idle')} value={view.codexSessions.filter((session) => !session.active).length} /></div>
          <div className="mt-4 space-y-2">{codexRecentCompleted.length ? codexRecentCompleted.map((session) => <Row key={session.id} title={session.label || session.key || session.id} detail={formatShanghaiDateTime(session.lastActivity, locale)} />) : <Empty text={t('codex.empty')} />}</div>
        </Section>

        <Section title={t('schedules.title')} action={<button onClick={() => navigate('cron')} className="text-xs text-primary hover:underline">{t('viewAll')}</button>}>
          <div className="grid grid-cols-2 gap-3 text-sm"><Stat label={t('schedules.ranToday')} value={jobsRunToday} /><Stat label={t('schedules.failedToday')} value={jobsFailedToday} danger={jobsFailedToday > 0} /><Stat label={t('schedules.nextRun')} value={nextJob ? formatShanghaiDateTime(nextJob.nextRun, locale) : '—'} /><Stat label={t('schedules.paused')} value={pausedJobs} /></div>
        </Section>

        <Section title={t('activity.title')} action={<button onClick={() => navigate('activity')} className="text-xs text-primary hover:underline">{t('viewAll')}</button>}>
          <div className="space-y-2">{data.activities.length ? data.activities.slice(0, 6).map((activity) => <Row key={activity.id} title={activity.description} detail={`${activity.actor} · ${formatShanghaiDateTime(activity.created_at, locale)}`} />) : <Empty text={t('activity.empty')} />}</div>
        </Section>
      </div>
    </div>
  )
}

function isSameShanghaiDay(value: number): boolean {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const ms = value < 10_000_000_000 ? value * 1000 : value
  return format.format(ms) === format.format(Date.now())
}

function Stat({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return <div className="rounded-lg bg-secondary/45 p-3"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`mt-1 font-medium tabular-nums ${danger ? 'text-red-400' : 'text-foreground'}`}>{value}</div></div>
}

function Row({ title, detail }: { title: string; detail: string }) {
  return <div className="min-w-0 rounded-lg border border-border/60 p-2.5"><div className="truncate text-xs text-foreground">{title}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</div></div>
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-xs text-muted-foreground">{text}</p>
}
