'use client'

import { useTranslations } from 'next-intl'
import type { DashboardData, LogLike } from '../widget-primitives'

function timeAgo(timestamp: number, labels: { justNow: string; minutesAgo: (count: number) => string; hoursAgo: (count: number) => string; daysAgo: (count: number) => string }): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return labels.justNow
  if (mins < 60) return labels.minutesAgo(mins)
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return labels.hoursAgo(hrs)
  return labels.daysAgo(Math.floor(hrs / 24))
}

function getSourceLabel(source: string, gatewayLabel: string): string {
  if (source.includes('claude')) return 'Claude'
  if (source.includes('codex')) return 'Codex'
  if (source.includes('hermes')) return 'Hermes'
  if (source.includes('gateway')) return gatewayLabel
  if (source.includes('mc') || source.includes('mission')) return 'MC'
  return source.length > 10 ? source.slice(0, 10) : source
}

type StatusKind = 'error' | 'done' | 'running' | 'idle' | 'warning' | 'info'

function getStatusBadge(log: LogLike): { kind: StatusKind; className: string } {
  if (log.level === 'error') return { kind: 'error', className: 'text-red-400 bg-red-500/10 border-red-500/20' }
  if (log.message.toLowerCase().includes('completed') || log.message.toLowerCase().includes('done'))
    return { kind: 'done', className: 'text-green-400 bg-green-500/10 border-green-500/20' }
  if (log.message.toLowerCase().includes('started') || log.message.toLowerCase().includes('running') || log.message.toLowerCase().includes('active'))
    return { kind: 'running', className: 'text-blue-400 bg-blue-500/10 border-blue-500/20' }
  if (log.message.toLowerCase().includes('idle') || log.message.toLowerCase().includes('waiting'))
    return { kind: 'idle', className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' }
  if (log.level === 'warn')
    return { kind: 'warning', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }
  return { kind: 'info', className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' }
}

export function ActivityTimelineWidget({ data }: { data: DashboardData }) {
  const t = useTranslations('fullDashboard')
  const { mergedRecentLogs, isSessionsLoading } = data
  const relativeTime = {
    justNow: t('relativeTime.justNow'),
    minutesAgo: (count: number) => t('relativeTime.minutesAgo', { count }),
    hoursAgo: (count: number) => t('relativeTime.hoursAgo', { count }),
    daysAgo: (count: number) => t('relativeTime.daysAgo', { count }),
  }
  const statusLabels: Record<StatusKind, string> = {
    error: t('status.error'), done: t('status.done'), running: t('status.running'),
    idle: t('status.idle'), warning: t('status.warning'), info: t('status.info'),
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">{t('activity.title')}</h3>
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {t('activity.live')}
        </span>
      </div>
      <div className="max-h-[340px] overflow-y-auto">
        {mergedRecentLogs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {isSessionsLoading ? t('activity.loading') : t('activity.empty')}
            </p>
            <p className="text-2xs text-muted-foreground/60 mt-1">{t('activity.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {mergedRecentLogs.map((log) => {
              const badge = getStatusBadge(log)
              return (
                <div key={log.id} className="px-4 py-2.5 hover:bg-secondary/30 transition-smooth group">
                  <div className="flex items-start gap-3">
                    {/* Time column */}
                    <span className="text-2xs text-muted-foreground/60 font-mono-tight w-14 shrink-0 pt-0.5">
                      {timeAgo(log.timestamp, relativeTime)}
                    </span>

                    {/* Source badge */}
                    <span className="text-2xs font-medium text-foreground/60 w-14 shrink-0 pt-0.5">
                      {getSourceLabel(log.source, t('gateway'))}
                    </span>

                    {/* Message */}
                    <p className="flex-1 text-xs text-foreground/80 min-w-0 wrap-break-word leading-relaxed">
                      {log.message.length > 120 ? log.message.slice(0, 120) + '...' : log.message}
                    </p>

                    {/* Status badge */}
                    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border shrink-0 ${badge.className}`}>
                      {statusLabels[badge.kind]}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
