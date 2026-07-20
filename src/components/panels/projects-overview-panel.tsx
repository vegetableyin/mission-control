'use client'

import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useMissionControl, type Project, type Task } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { buildProjectStatus, formatShanghaiDateTime } from '@/lib/command-center'
import { Button } from '@/components/ui/button'

export function ProjectsOverviewPanel() {
  const t = useTranslations('projectsOverview')
  const locale = useLocale() === 'zh' ? 'zh-CN' : 'en-US'
  const navigate = useNavigateToPanel()
  const { setActiveProject, setShowProjectManagerModal } = useMissionControl()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [projectResult, taskResult] = await Promise.allSettled([
      apiFetch<{ projects?: Project[] }>('/api/projects?includeArchived=1'),
      apiFetch<{ tasks?: Task[] }>('/api/tasks?limit=200'),
    ])
    setProjects(projectResult.status === 'fulfilled' ? projectResult.value.projects || [] : [])
    setTasks(taskResult.status === 'fulfilled' ? taskResult.value.tasks || [] : [])
    setLoading(false)
  }, [])
  useSmartPoll(load, 30_000)

  const rows = useMemo(() => buildProjectStatus(projects, tasks), [projects, tasks])

  const openTasks = (project: Project) => {
    setActiveProject(project)
    navigate('tasks')
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('description')}</p></div>
        <Button size="sm" onClick={() => setShowProjectManagerModal(true)}>{t('manage')}</Button>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? <p className="p-8 text-center text-sm text-muted-foreground">{t('loading')}</p> : rows.length === 0 ? (
          <div className="p-10 text-center"><p className="text-sm text-muted-foreground">{t('empty')}</p><Button className="mt-4" size="sm" onClick={() => setShowProjectManagerModal(true)}>{t('create')}</Button></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border bg-secondary/30 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">{t('name')}</th><th className="px-4 py-3 font-medium">{t('status')}</th><th className="px-4 py-3 font-medium">{t('lastActivity')}</th><th className="px-4 py-3 text-right font-medium">{t('unfinished')}</th><th className="px-4 py-3 text-right font-medium">{t('failed')}</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border/60">{rows.map((project) => <tr key={project.id} className="hover:bg-secondary/25"><td className="px-4 py-3"><div className="font-medium text-foreground">{project.name}</div>{project.description && <div className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">{project.description}</div>}</td><td className="px-4 py-3"><Status project={project} t={t} /></td><td className="px-4 py-3 text-xs text-muted-foreground">{formatShanghaiDateTime(project.lastActivity, locale)}</td><td className="px-4 py-3 text-right tabular-nums">{project.unfinishedTasks}</td><td className={`px-4 py-3 text-right tabular-nums ${project.failedTasks ? 'text-red-400' : 'text-muted-foreground'}`}>{project.failedTasks}</td><td className="px-4 py-3 text-right"><button onClick={() => openTasks(project)} className="text-xs text-primary hover:underline">{t('openTasks')}</button></td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  )
}

function Status({ project, t }: { project: ReturnType<typeof buildProjectStatus>[number]; t: ReturnType<typeof useTranslations<'projectsOverview'>> }) {
  if (project.blocked) return <span className="text-xs text-red-400">{t('blocked')}</span>
  if (project.stale) return <span className="text-xs text-amber-400">{t('stale')}</span>
  if (project.status === 'active') return <span className="text-xs text-emerald-400">{t('active')}</span>
  return <span className="text-xs text-muted-foreground">{project.status}</span>
}
