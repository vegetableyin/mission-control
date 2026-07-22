'use client'

import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useMissionControl, type Project } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { formatShanghaiDateTime } from '@/lib/command-center'
import { Button } from '@/components/ui/button'

interface Candidate { name: string; localPath: string; depth: number; projectType: string; isGit: boolean; markers: string[] }
interface ScanHistory { id: number; status: string; duration_ms: number; error?: string | null; created_at: number }
interface ProjectDetail { project: Project; tasks: Array<{ id: number; title: string; status: string; updated_at?: number; error_message?: string | null }>; scan_history: ScanHistory[] }
type ViewMode = 'table' | 'cards'

const lifecycle = ['not_started', 'in_progress', 'waiting', 'blocked', 'review', 'completed', 'paused', 'archived'] as const
const healthStates = ['healthy', 'attention', 'blocked', 'stale', 'unknown'] as const

export function ProjectsOverviewPanel() {
  const t = useTranslations('projectsOverview')
  const locale = useLocale() === 'zh' ? 'zh-CN' : 'en-US'
  const navigate = useNavigateToPanel()
  const { setActiveProject } = useMissionControl()
  const [projects, setProjects] = useState<Project[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [tab, setTab] = useState<'inventory' | 'candidates'>('inventory')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [healthFilter, setHealthFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [sort, setSort] = useState('priority')
  const [editor, setEditor] = useState<Partial<Project> | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ projects?: Project[] }>('/api/projects?includeArchived=1')
      setProjects(data.projects || [])
    } finally { setLoading(false) }
  }, [])
  useSmartPoll(load, 30_000)

  const values = useMemo(() => ({
    types: [...new Set(projects.map((p) => p.project_type).filter(Boolean) as string[])].sort(),
    owners: [...new Set(projects.map((p) => p.owner).filter(Boolean) as string[])].sort(),
  }), [projects])

  const rows = useMemo(() => {
    const filtered = projects.filter((project) => {
      const haystack = [project.name, project.description, project.local_path, project.next_action, project.blocker].filter(Boolean).join(' ').toLowerCase()
      return (!query || haystack.includes(query.toLowerCase()))
        && (statusFilter === 'all' || project.status === statusFilter)
        && (healthFilter === 'all' || project.health_status === healthFilter)
        && (typeFilter === 'all' || project.project_type === typeFilter)
        && (ownerFilter === 'all' || project.owner === ownerFilter)
    })
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name, locale))
    if (sort === 'activity') return [...filtered].sort((a, b) => Number(b.last_activity_at || 0) - Number(a.last_activity_at || 0))
    if (sort === 'score') return [...filtered].sort((a, b) => Number(a.health_score ?? -1) - Number(b.health_score ?? -1))
    return filtered
  }, [projects, query, statusFilter, healthFilter, typeFilter, ownerFilter, sort, locale])

  const action = async (key: string, operation: () => Promise<void>) => {
    setBusy(key); setFeedback(null)
    try { await operation() } catch (error) { setFeedback(error instanceof Error ? error.message : t('operationFailed')) }
    finally { setBusy(null) }
  }

  const discover = () => action('discover', async () => {
    const data = await apiFetch<{ candidates?: Candidate[] }>('/api/projects/discovery')
    setCandidates(data.candidates || []); setTab('candidates'); setFeedback(t('scanComplete', { count: data.candidates?.length || 0 }))
  })

  const importCandidate = (candidate: Candidate) => action(`import-${candidate.localPath}`, async () => {
    await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: candidate.name, local_path: candidate.localPath, project_type: candidate.projectType, status: 'not_started' }) })
    setCandidates((current) => current.filter((item) => item.localPath !== candidate.localPath)); await load(); setFeedback(t('imported', { name: candidate.name }))
  })

  const scanProject = (project: Project) => action(`scan-${project.id}`, async () => {
    await apiFetch('/api/projects/scan', { method: 'POST', body: JSON.stringify({ projectId: project.id }) }); await load(); setFeedback(t('projectScanned', { name: project.name }))
  })

  const scanAll = () => action('scan-all', async () => {
    const result = await apiFetch<{ results: Array<{ ok: boolean }> }>('/api/projects/scan', { method: 'POST', body: '{}' }); await load()
    setFeedback(t('allScanned', { count: result.results.filter((item) => item.ok).length }))
  })

  const patchProject = async (project: Project, patch: Record<string, unknown>) => {
    await apiFetch(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); await load()
  }

  const openDetail = (project: Project) => action(`detail-${project.id}`, async () => {
    setDetail(await apiFetch<ProjectDetail>(`/api/projects/${project.id}`))
  })

  const openTasks = (project: Project) => { setActiveProject(project); navigate('tasks') }

  return (
    <div className="mx-auto max-w-[1720px] space-y-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('description')}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={discover}>{busy === 'discover' ? t('scanning') : t('scanWork')}</Button>
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={scanAll}>{busy === 'scan-all' ? t('scanning') : t('scanAll')}</Button>
          <Button size="sm" onClick={() => setEditor({ status: 'not_started', priority: 'medium', scan_enabled: true, stale_after_days: 7 })}>{t('create')}</Button>
        </div>
      </header>

      {feedback && <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-foreground">{feedback}</div>}

      <div className="flex gap-1 border-b border-border">
        <button className={`px-3 py-2 text-sm ${tab === 'inventory' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`} onClick={() => setTab('inventory')}>{t('inventory')} ({projects.length})</button>
        <button className={`px-3 py-2 text-sm ${tab === 'candidates' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`} onClick={() => setTab('candidates')}>{t('candidates')} ({candidates.length})</button>
      </div>

      {tab === 'candidates' ? (
        <CandidateList candidates={candidates} busy={busy} onImport={importCandidate} t={t} />
      ) : (
        <>
          <div className="grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-3 xl:grid-cols-8">
            <input aria-label={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} className="rounded-md border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
            <Filter value={statusFilter} onChange={setStatusFilter} label={t('status')} options={lifecycle.map((value) => ({ value, label: t(`statuses.${value}`) }))} all={t('all')} />
            <Filter value={healthFilter} onChange={setHealthFilter} label={t('health')} options={healthStates.map((value) => ({ value, label: t(`healthStates.${value}`) }))} all={t('all')} />
            <Filter value={typeFilter} onChange={setTypeFilter} label={t('projectType')} options={values.types.map((value) => ({ value, label: value }))} all={t('all')} />
            <Filter value={ownerFilter} onChange={setOwnerFilter} label={t('owner')} options={values.owners.map((value) => ({ value, label: value }))} all={t('all')} />
            <Filter value={sort} onChange={setSort} label={t('sort')} options={['priority', 'activity', 'score', 'name'].map((value) => ({ value, label: t(`sorts.${value}`) }))} />
            <div className="flex rounded-md border border-border p-0.5"><button className={`flex-1 rounded px-2 text-xs ${viewMode === 'table' ? 'bg-secondary' : ''}`} onClick={() => setViewMode('table')}>{t('table')}</button><button className={`flex-1 rounded px-2 text-xs ${viewMode === 'cards' ? 'bg-secondary' : ''}`} onClick={() => setViewMode('cards')}>{t('cards')}</button></div>
          </div>
          {loading ? <p className="p-8 text-center text-sm text-muted-foreground">{t('loading')}</p> : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center"><p className="text-sm text-muted-foreground">{t('emptyInventory')}</p><Button className="mt-4" size="sm" onClick={discover}>{t('scanWork')}</Button></div>
          ) : viewMode === 'table' ? (
            <ProjectTable projects={rows} busy={busy} locale={locale} t={t} onDetail={openDetail} onScan={scanProject} onEdit={setEditor} onToggleScan={(p) => patchProject(p, { scan_enabled: !p.scan_enabled })} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((project) => <ProjectCard key={project.id} project={project} busy={busy} locale={locale} t={t} onDetail={openDetail} onScan={scanProject} onEdit={setEditor} />)}</div>
          )}
        </>
      )}

      {editor && <ProjectEditor project={editor} t={t} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load() }} />}
      {detail && <ProjectDetailDialog detail={detail} locale={locale} t={t} onClose={() => setDetail(null)} onEdit={() => { setEditor(detail.project); setDetail(null) }} onTasks={() => openTasks(detail.project)} onRefresh={() => openDetail(detail.project)} onPatch={patchProject} />}
    </div>
  )
}

function Filter({ value, onChange, label, options, all }: { value: string; onChange: (value: string) => void; label: string; options: Array<{ value: string; label: string }>; all?: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-border bg-background px-2 py-2 text-xs">{all && <option value="all">{all} · {label}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
}

function CandidateList({ candidates, busy, onImport, t }: { candidates: Candidate[]; busy: string | null; onImport: (candidate: Candidate) => void; t: any }) {
  if (!candidates.length) return <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{t('candidateEmpty')}</div>
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{candidates.map((candidate) => <article key={candidate.localPath} className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-medium text-foreground">{candidate.name}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{candidate.localPath}</p></div><span className="rounded bg-secondary px-2 py-1 text-[11px]">{candidate.projectType}</span></div><div className="mt-3 flex flex-wrap gap-1">{candidate.markers.map((marker) => <span key={marker} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{marker}</span>)}</div><Button className="mt-4" size="sm" disabled={Boolean(busy)} onClick={() => onImport(candidate)}>{busy === `import-${candidate.localPath}` ? t('importing') : t('import')}</Button></article>)}</div>
}

function ProjectTable({ projects, busy, locale, t, onDetail, onScan, onEdit, onToggleScan }: { projects: Project[]; busy: string | null; locale: string; t: any; onDetail: (p: Project) => void; onScan: (p: Project) => void; onEdit: (p: Project) => void; onToggleScan: (p: Project) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full min-w-[1500px] text-left text-xs"><thead className="border-b border-border bg-secondary/30 text-muted-foreground"><tr>{['name','projectType','stage','status','health','localPath','gitBranch','lastCommit','dirty','lastActivity','nextAction','risk','scanStatus'].map((key) => <th key={key} className="px-3 py-3 font-medium">{t(key)}</th>)}<th /></tr></thead><tbody className="divide-y divide-border/60">{projects.map((project) => <tr key={project.id} className="hover:bg-secondary/20"><td className="px-3 py-3"><button className="font-medium text-foreground hover:text-primary" onClick={() => onDetail(project)}>{project.name}</button></td><td className="px-3 py-3">{project.project_type || '—'}</td><td className="px-3 py-3">{project.stage || '—'}</td><td className="px-3 py-3"><Badge tone={project.status === 'blocked' ? 'danger' : 'neutral'}>{t(`statuses.${project.status}`)}</Badge></td><td className="px-3 py-3"><Health project={project} t={t} /></td><td className="max-w-[220px] truncate px-3 py-3" title={project.local_path || ''}>{project.local_path || '—'}</td><td className="px-3 py-3">{project.git_detached_head ? t('detached') : project.git_branch || '—'}</td><td className="max-w-[180px] px-3 py-3"><div className="truncate">{project.git_last_commit_title || '—'}</div><div className="text-[10px] text-muted-foreground">{formatShanghaiDateTime(project.git_last_commit_at, locale)}</div></td><td className="px-3 py-3">{project.git_dirty == null ? '—' : t(project.git_dirty ? 'yes' : 'no')} {project.git_dirty ? `(${Number(project.git_modified_count || 0) + Number(project.git_untracked_count || 0)})` : ''}</td><td className="px-3 py-3">{formatShanghaiDateTime(project.last_activity_at, locale)}</td><td className="max-w-[180px] truncate px-3 py-3" title={project.next_action || ''}>{project.next_action || '—'}</td><td className="max-w-[160px] truncate px-3 py-3 text-red-400" title={project.blocker || project.scan_error || ''}>{project.blocker || project.scan_error || '—'}</td><td className="px-3 py-3"><button onClick={() => onToggleScan(project)} className={project.scan_enabled ? 'text-emerald-400' : 'text-muted-foreground'}>{t(project.scan_enabled ? 'enabled' : 'disabled')}</button></td><td className="px-3 py-3"><div className="flex gap-2"><button className="text-primary" onClick={() => onDetail(project)}>{t('details')}</button><button className="text-primary" onClick={() => onEdit(project)}>{t('edit')}</button>{project.scan_enabled && project.local_path && <button disabled={Boolean(busy)} className="text-primary disabled:opacity-50" onClick={() => onScan(project)}>{t('scan')}</button>}</div></td></tr>)}</tbody></table></div>
}

function ProjectCard({ project, busy, locale, t, onDetail, onScan, onEdit }: { project: Project; busy: string | null; locale: string; t: any; onDetail: (p: Project) => void; onScan: (p: Project) => void; onEdit: (p: Project) => void }) {
  return <article className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-2"><button className="font-medium text-foreground hover:text-primary" onClick={() => onDetail(project)}>{project.name}</button><Health project={project} t={t} /></div><p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{project.description || t('noDescription')}</p><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><Info label={t('status')} value={t(`statuses.${project.status}`)} /><Info label={t('projectType')} value={project.project_type || '—'} /><Info label={t('gitBranch')} value={project.git_branch || '—'} /><Info label={t('lastActivity')} value={formatShanghaiDateTime(project.last_activity_at, locale)} /></dl><div className="mt-4 flex gap-2"><Button size="xs" variant="outline" onClick={() => onDetail(project)}>{t('details')}</Button><Button size="xs" variant="outline" onClick={() => onEdit(project)}>{t('edit')}</Button>{project.scan_enabled && project.local_path && <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => onScan(project)}>{t('scan')}</Button>}</div></article>
}

function ProjectEditor({ project, t, onClose, onSaved }: { project: Partial<Project>; t: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => ({ name: project.name || '', description: project.description || '', project_type: project.project_type || 'other', local_path: project.local_path || '', github_repository: project.github_repository || project.github_repo || '', owner: project.owner || '', customer: project.customer || '', stage: project.stage || '', status: project.status || 'not_started', priority: project.priority || 'medium', next_action: project.next_action || '', blocker: project.blocker || '', stale_after_days: project.stale_after_days || 7, scan_enabled: project.scan_enabled ?? true }))
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null)
  const update = (key: string, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => { setSaving(true); setError(null); try { await apiFetch(project.id ? `/api/projects/${project.id}` : '/api/projects', { method: project.id ? 'PATCH' : 'POST', body: JSON.stringify(form) }); onSaved() } catch (err) { setError(err instanceof Error ? err.message : t('operationFailed')) } finally { setSaving(false) } }
  return <Modal title={project.id ? t('editProject') : t('newProject')} onClose={onClose}><div className="grid gap-3 sm:grid-cols-2"><Field label={t('name')} value={form.name} onChange={(v) => update('name', v)} required /><Field label={t('projectType')} value={form.project_type} onChange={(v) => update('project_type', v)} /><Field label={t('localPath')} value={form.local_path} onChange={(v) => update('local_path', v)} wide /><Field label={t('githubRepository')} value={form.github_repository} onChange={(v) => update('github_repository', v)} wide /><Field label={t('owner')} value={form.owner} onChange={(v) => update('owner', v)} /><Field label={t('customer')} value={form.customer} onChange={(v) => update('customer', v)} /><Field label={t('stage')} value={form.stage} onChange={(v) => update('stage', v)} /><SelectField label={t('status')} value={form.status} onChange={(v) => update('status', v)} options={lifecycle.map((value) => ({ value, label: t(`statuses.${value}`) }))} /><SelectField label={t('priority')} value={form.priority} onChange={(v) => update('priority', v)} options={['low','medium','high','critical'].map((value) => ({ value, label: t(`priorities.${value}`) }))} /><Field label={t('staleDays')} value={String(form.stale_after_days)} type="number" onChange={(v) => update('stale_after_days', Number(v))} /><Field label={t('nextAction')} value={form.next_action} onChange={(v) => update('next_action', v)} wide /><Field label={t('blocker')} value={form.blocker} onChange={(v) => update('blocker', v)} wide /><Field label={t('descriptionLabel')} value={form.description} onChange={(v) => update('description', v)} wide /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.scan_enabled} onChange={(event) => update('scan_enabled', event.target.checked)} />{t('scanEnabled')}</label></div>{error && <p className="mt-3 text-xs text-red-400">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button disabled={saving || !form.name.trim()} onClick={save}>{saving ? t('saving') : t('save')}</Button></div></Modal>
}

function ProjectDetailDialog({ detail, locale, t, onClose, onEdit, onTasks, onRefresh, onPatch }: { detail: ProjectDetail; locale: string; t: any; onClose: () => void; onEdit: () => void; onTasks: () => void; onRefresh: () => void; onPatch: (p: Project, patch: Record<string, unknown>) => Promise<void> }) {
  const p = detail.project; const github = toGithubUrl(p.github_repository || p.git_origin_url)
  const archive = async () => { await onPatch(p, { archived: !p.archived }); await onRefresh() }
  const toggleScan = async () => { await onPatch(p, { scan_enabled: !p.scan_enabled }); await onRefresh() }
  const openLocal = async () => { if (window.confirm(t('openFolderConfirm'))) await apiFetch(`/api/projects/${p.id}/open`, { method: 'POST', body: '{}' }) }
  return <Modal title={p.name} onClose={onClose} wide><div className="flex flex-wrap gap-2"><Health project={p} t={t} /><Badge>{t(`statuses.${p.status}`)}</Badge>{p.health_score != null && <Badge>{t('scoreValue', { score: p.health_score })}</Badge>}</div><div className="mt-4 grid gap-4 lg:grid-cols-2"><Section title={t('basicInfo')}><InfoGrid rows={[[t('projectType'),p.project_type],[t('stage'),p.stage],[t('owner'),p.owner],[t('customer'),p.customer],[t('priority'),p.priority ? t(`priorities.${p.priority}`) : null],[t('lastActivity'),formatShanghaiDateTime(p.last_activity_at, locale)]]} /></Section><Section title={t('gitStatus')}><InfoGrid rows={[[t('gitBranch'),p.git_detached_head ? t('detached') : p.git_branch],[t('headSha'),p.git_head_sha?.slice(0,12)],[t('lastCommit'),p.git_last_commit_title],[t('dirty'),p.git_dirty == null ? null : t(p.git_dirty ? 'yes' : 'no')],[t('changes'),p.git_dirty ? String(Number(p.git_modified_count || 0)+Number(p.git_untracked_count || 0)) : '0'],[t('aheadBehind'),`${p.git_ahead_count ?? '?'} / ${p.git_behind_count ?? '?'}`],[t('origin'),p.git_origin_url]]} /></Section><Section title={t('healthDetails')}>{p.health_reasons?.length ? <ul className="space-y-2">{p.health_reasons.map((reason, index) => <li key={`${reason.code}-${index}`} className="flex justify-between gap-3 text-xs"><span>{t(`healthReasons.${reason.code}`, { value: reason.detail ?? '' })}</span><span className="text-red-400">-{reason.deduction}</span></li>)}</ul> : <p className="text-xs text-muted-foreground">{t('noHealthReasons')}</p>}</Section><Section title={t('actionsAndRisks')}><InfoGrid rows={[[t('nextAction'),p.next_action],[t('blocker'),p.blocker],[t('localPath'),p.local_path],[t('lastScan'),formatShanghaiDateTime(p.last_scan_at, locale)],[t('scanError'),p.scan_error]]} /></Section><Section title={t('relatedTasks')}>{detail.tasks.length ? <div className="space-y-2">{detail.tasks.slice(0,8).map((task) => <div key={task.id} className="rounded border border-border p-2 text-xs"><div className="flex justify-between gap-2"><span>{task.title}</span><span>{task.status}</span></div>{task.error_message && <p className="mt-1 text-red-400">{task.error_message}</p>}</div>)}</div> : <p className="text-xs text-muted-foreground">{t('noTasks')}</p>}</Section><Section title={t('scanHistory')}>{detail.scan_history.length ? <div className="space-y-2">{detail.scan_history.map((scan) => <div key={scan.id} className="flex justify-between gap-3 text-xs"><span>{formatShanghaiDateTime(scan.created_at, locale)} · {scan.duration_ms}ms</span><span className={scan.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>{scan.error || scan.status}</span></div>)}</div> : <p className="text-xs text-muted-foreground">{t('noScans')}</p>}</Section></div><div className="mt-5 flex flex-wrap gap-2"><Button size="sm" onClick={onEdit}>{t('edit')}</Button><Button size="sm" variant="outline" onClick={onTasks}>{t('openTasks')}</Button>{p.local_path && <Button size="sm" variant="outline" onClick={openLocal}>{t('openLocal')}</Button>}{github && <a href={github} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-border px-3 text-xs hover:bg-secondary">{t('openGithub')}</a>}<Button size="sm" variant="outline" onClick={toggleScan}>{t(p.scan_enabled ? 'disableScan' : 'enableScan')}</Button>{p.slug !== 'general' && <Button size="sm" variant="outline" onClick={archive}>{t(p.archived ? 'restore' : 'archive')}</Button>}</div></Modal>
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">×</button></div>{children}</div></div> }
function Field({ label, value, onChange, wide, required, type='text' }: { label: string; value: string; onChange: (v:string)=>void; wide?: boolean; required?: boolean; type?: string }) { return <label className={`text-xs text-muted-foreground ${wide ? 'sm:col-span-2' : ''}`}>{label}<input type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" /></label> }
function SelectField({ label, value, onChange, options }: { label:string; value:string; onChange:(v:string)=>void; options:Array<{value:string;label:string}> }) { return <label className="text-xs text-muted-foreground">{label}<select value={value} onChange={(event)=>onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">{options.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function Badge({ children, tone='neutral' }: { children: React.ReactNode; tone?: 'neutral'|'danger'|'warn'|'good' }) { const color={neutral:'bg-secondary text-muted-foreground',danger:'bg-red-500/15 text-red-400',warn:'bg-amber-500/15 text-amber-400',good:'bg-emerald-500/15 text-emerald-400'}[tone]; return <span className={`inline-flex rounded px-2 py-1 text-[11px] ${color}`}>{children}</span> }
function Health({ project, t }: { project: Project; t: any }) { const status=project.health_status || 'unknown'; const tone=status==='healthy'?'good':status==='attention'||status==='stale'?'warn':status==='blocked'?'danger':'neutral'; return <Badge tone={tone}>{t(`healthStates.${status}`)}{project.health_score != null ? ` · ${project.health_score}` : ''}</Badge> }
function Info({ label, value }: { label:string; value:string }) { return <div><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate text-xs text-foreground">{value}</dd></div> }
function InfoGrid({ rows }: { rows:Array<[string, unknown]> }) { return <dl className="grid gap-3 sm:grid-cols-2">{rows.map(([label,value])=><Info key={label} label={label} value={value == null || value === '' ? '—' : String(value)} />)}</dl> }
function Section({ title, children }: { title:string; children:React.ReactNode }) { return <section className="rounded-lg border border-border p-4"><h3 className="mb-3 text-sm font-medium">{title}</h3>{children}</section> }
function toGithubUrl(value?: string | null): string | null { if(!value) return null; const cleaned=value.trim().replace(/\.git$/,''); if(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(cleaned)) return cleaned; const ssh=cleaned.match(/^git@github\.com:([\w.-]+\/[\w.-]+)$/); return ssh?`https://github.com/${ssh[1]}`:null }
