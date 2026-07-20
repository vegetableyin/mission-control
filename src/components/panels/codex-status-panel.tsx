'use client'

import { useCallback, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { formatShanghaiDateTime } from '@/lib/command-center'
import type { Session } from '@/store'

interface RuntimeStatus {
  id: string
  installed: boolean
  version: string | null
  running: boolean
  authRequired: boolean
  authenticated: boolean
  authHint?: string
}

export function CodexStatusPanel() {
  const t = useTranslations('codexStatus')
  const locale = useLocale() === 'zh' ? 'zh-CN' : 'en-US'
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [runtimeError, setRuntimeError] = useState(false)

  const load = useCallback(async () => {
    const [runtimeResult, sessionResult] = await Promise.allSettled([
      apiFetch<{ runtimes?: RuntimeStatus[] }>('/api/agent-runtimes'),
      apiFetch<{ sessions?: Session[] }>('/api/sessions'),
    ])
    if (runtimeResult.status === 'fulfilled') {
      setRuntime(runtimeResult.value.runtimes?.find((item) => item.id === 'codex') || null)
      setRuntimeError(false)
    } else {
      setRuntimeError(true)
    }
    setSessions(sessionResult.status === 'fulfilled' ? (sessionResult.value.sessions || []).filter((session) => session.kind.toLowerCase().includes('codex')) : [])
    setLoading(false)
  }, [])
  useSmartPoll(load, 20_000)

  const ordered = useMemo(() => [...sessions].sort((a, b) => Number(b.active) - Number(a.active) || (b.lastActivity || 0) - (a.lastActivity || 0)), [sessions])
  const status = runtimeError ? 'configError' : !runtime?.installed ? 'notInstalled' : runtime.authRequired && !runtime.authenticated ? 'notLoggedIn' : runtime.running || ordered.some((session) => session.active) ? 'running' : 'normal'
  const totalTokens = ordered.reduce((total, session) => total + parseTokenCount(session.tokens), 0)

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6 space-y-5">
      <div><h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('description')}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatusCard label={t('installation')} value={loading ? t('checking') : t(`status.${status}`)} tone={status} />
        <StatusCard label={t('login')} value={runtime?.authenticated ? t('status.loggedIn') : t('status.notLoggedIn')} tone={runtime?.authenticated ? 'normal' : 'notLoggedIn'} />
        <StatusCard label={t('version')} value={runtime?.version || '—'} />
        <StatusCard label={t('activeSessions')} value={ordered.filter((session) => session.active).length} />
        <StatusCard label={t('tokenUsage')} value={totalTokens ? totalTokens.toLocaleString('zh-CN') : '—'} />
      </div>
      {runtimeError && <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{t('configurationError')}</div>}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{t('sessions')}</h2></div>
        {loading ? <p className="p-8 text-center text-sm text-muted-foreground">{t('checking')}</p> : ordered.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">{t('empty')}</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="bg-secondary/30 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">{t('session')}</th><th className="px-4 py-3 font-medium">{t('projectDirectory')}</th><th className="px-4 py-3 font-medium">{t('model')}</th><th className="px-4 py-3 font-medium">{t('tokens')}</th><th className="px-4 py-3 font-medium">{t('lastActivity')}</th><th className="px-4 py-3 font-medium">{t('state')}</th></tr></thead><tbody className="divide-y divide-border/60">{ordered.map((session) => <tr key={session.id}><td className="px-4 py-3 font-medium text-foreground">{session.label || session.key || session.id}</td><td className="max-w-[320px] truncate px-4 py-3 font-mono text-[11px] text-muted-foreground">{session.key || '—'}</td><td className="px-4 py-3">{session.model || '—'}</td><td className="px-4 py-3 tabular-nums">{session.tokens || '—'}</td><td className="px-4 py-3 text-muted-foreground">{formatShanghaiDateTime(session.lastActivity, locale)}</td><td className="px-4 py-3"><span className={session.active ? 'text-emerald-400' : 'text-muted-foreground'}>{session.active ? t('status.running') : t('status.idle')}</span></td></tr>)}</tbody></table></div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('privacyNote')}</p>
    </div>
  )
}

function parseTokenCount(value?: string): number {
  if (!value) return 0
  const match = value.toLowerCase().match(/([\d.]+)\s*([km]?)/)
  if (!match) return 0
  return Math.round(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1))
}

function StatusCard({ label, value, tone = 'normal' }: { label: string; value: string | number; tone?: string }) {
  const warning = ['notLoggedIn', 'configError'].includes(tone)
  const danger = tone === 'notInstalled'
  return <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-2 text-sm font-semibold ${danger ? 'text-red-400' : warning ? 'text-amber-400' : 'text-foreground'}`}>{value}</div></div>
}
