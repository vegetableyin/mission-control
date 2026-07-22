'use client'

import { useTranslations } from 'next-intl'
import {
  QuickAction,
  SpawnActionIcon,
  LogActionIcon,
  TaskActionIcon,
  MemoryActionIcon,
  SessionIcon,
  PipelineActionIcon,
  type DashboardData,
} from '../widget-primitives'

/** Pick contextual actions based on current fleet/task state */
function getContextualActions(data: DashboardData, labels: {
  checkErrorLogs: string; errorsDetected: string; reviewPending: string; awaitingReview: string
  dispatchTask: string; agentsIdle: string; createFirstAgent: string; setUpFleet: string
  sessions: string; agents: string; fleetManagement: string; viewLogs: string; realtimeViewer: string
  taskBoard: string; taskCounts: string; memory: string; knowledgeRecall: string
}): Array<{
  label: string
  desc: string
  tab: string
  icon: React.ReactNode
  priority: number
}> {
  const {
    isLocal,
    activeSessions,
    errorCount,
    reviewCount,
    runningTasks,
    backlogCount,
    agents,
    dbStats,
  } = data

  const actions: Array<{
    label: string
    desc: string
    tab: string
    icon: React.ReactNode
    priority: number
  }> = []

  const agentTotal = dbStats?.agents.total ?? agents.length

  // High priority: errors need attention
  if (errorCount > 0) {
    actions.push({
      label: labels.checkErrorLogs,
      desc: labels.errorsDetected,
      tab: 'logs',
      icon: <LogActionIcon />,
      priority: 100,
    })
  }

  // High priority: tasks waiting for review
  if (reviewCount > 0) {
    actions.push({
      label: labels.reviewPending,
      desc: labels.awaitingReview,
      tab: 'tasks',
      icon: <TaskActionIcon />,
      priority: 90,
    })
  }

  // Contextual: agents/sessions idle — suggest dispatching work
  if (activeSessions === 0 && agentTotal > 0) {
    actions.push({
      label: labels.dispatchTask,
      desc: labels.agentsIdle,
      tab: 'tasks',
      icon: <TaskActionIcon />,
      priority: 70,
    })
  }

  // No agents at all — guide to setup
  if (!isLocal && agentTotal === 0) {
    actions.push({
      label: labels.createFirstAgent,
      desc: labels.setUpFleet,
      tab: 'spawn',
      icon: <SpawnActionIcon />,
      priority: 80,
    })
  }

  // Default navigation actions (always available, lower priority)
  if (isLocal) {
    actions.push({
      label: labels.sessions,
      desc: 'Claude + Codex + Hermes',
      tab: 'sessions',
      icon: <SessionIcon />,
      priority: 30,
    })
  } else {
    actions.push({
      label: labels.agents,
      desc: labels.fleetManagement,
      tab: 'agents',
      icon: <PipelineActionIcon />,
      priority: 30,
    })
  }

  actions.push({
    label: labels.viewLogs,
    desc: labels.realtimeViewer,
    tab: 'logs',
    icon: <LogActionIcon />,
    priority: 20,
  })

  actions.push({
    label: labels.taskBoard,
    desc: labels.taskCounts,
    tab: 'tasks',
    icon: <TaskActionIcon />,
    priority: 25,
  })

  actions.push({
    label: labels.memory,
    desc: labels.knowledgeRecall,
    tab: 'memory',
    icon: <MemoryActionIcon />,
    priority: 10,
  })

  // Sort by priority descending, deduplicate by key
  const seen = new Set<string>()
  return actions
    .sort((a, b) => b.priority - a.priority)
    .filter((a) => {
      const key = `${a.tab}:${a.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 5)
}

export function QuickActionsWidget({ data }: { data: DashboardData }) {
  const t = useTranslations('fullDashboard.quickActions')
  const { navigateToPanel } = data
  const actions = getContextualActions(data, {
    checkErrorLogs: t('checkErrorLogs'), errorsDetected: t('errorsDetected', { count: data.errorCount }),
    reviewPending: t('reviewPending'), awaitingReview: t('awaitingReview', { count: data.reviewCount }),
    dispatchTask: t('dispatchTask'), agentsIdle: t('agentsIdle'), createFirstAgent: t('createFirstAgent'),
    setUpFleet: t('setUpFleet'), sessions: t('sessions'), agents: t('agents'), fleetManagement: t('fleetManagement'),
    viewLogs: t('viewLogs'), realtimeViewer: t('realtimeViewer'), taskBoard: t('taskBoard'),
    taskCounts: t('taskCounts', { running: data.runningTasks, queued: data.backlogCount }),
    memory: t('memory'), knowledgeRecall: t('knowledgeRecall'),
  })

  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      {actions.map((action) => (
        <QuickAction
          key={`${action.tab}-${action.label}`}
          label={action.label}
          desc={action.desc}
          tab={action.tab}
          icon={action.icon}
          onNavigate={navigateToPanel}
        />
      ))}
    </section>
  )
}
