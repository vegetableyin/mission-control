import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import zh from '../../../messages/zh.json'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Essential and Full interface localization', () => {
  it('provides Chinese resources for the remaining dashboard and settings labels', () => {
    expect(zh.fullDashboard.activity.title).toBe('活动记录')
    expect(zh.fullDashboard.fleet.title).toBe('运行状态')
    expect(zh.fullDashboard.pipeline.title).toBe('任务流程')
    expect(zh.fullDashboard.quickActions).toMatchObject({
      sessions: '会话', taskBoard: '任务看板', viewLogs: '查看日志', memory: '记忆',
    })
    expect(zh.fullDashboard.customize.customize).toBe('自定义')
    expect(zh.settings.categories).toMatchObject({
      general: '通用', profiles: '安全配置', retention: '数据保留', chat: '聊天', gateway: '网关',
    })
    expect(zh.settings.settingDefinitions).toMatchObject({
      siteName: { label: '站点名称' }, autoCleanup: { label: '自动清理' },
      autoBackup: { label: '自动备份' }, backupRetention: { label: '备份保留数量' },
      planOverride: { label: '订阅方案覆盖' },
    })
    expect(zh.settings.hermes).toMatchObject({
      gatewayRunning: '网关运行中', gatewayOffline: '网关已离线', working: '处理中...',
    })
    expect(zh.agentRuntimes).toMatchObject({
      title: '智能体运行时', installed: '已安装', running: '运行中', stopped: '已停止', refresh: '刷新',
    })
    expect(zh.nav.monitor).toBe('系统监控')
  })

  it('renders these labels through next-intl instead of literal JSX text', () => {
    const activity = read('src/components/dashboard/widgets/activity-timeline-widget.tsx')
    const fleet = read('src/components/dashboard/widgets/fleet-status-widget.tsx')
    const pipeline = read('src/components/dashboard/widgets/task-pipeline-widget.tsx')
    const settings = read('src/components/panels/settings-panel.tsx')
    const runtimes = read('src/components/settings/agent-runtimes-section.tsx')
    const nav = read('src/components/layout/nav-rail.tsx')

    expect(activity).toContain("useTranslations('fullDashboard')")
    expect(activity).not.toContain('>Activity</h3>')
    expect(fleet).not.toContain('>Fleet Status</h3>')
    expect(pipeline).not.toContain('>Task Pipeline</h3>')
    expect(settings).not.toContain("label: 'General'")
    expect(settings).not.toContain("label: 'Security Profiles'")
    expect(settings).not.toContain("'Gateway running'")
    expect(settings).not.toContain("'Gateway offline'")
    expect(runtimes).toContain("useTranslations('agentRuntimes')")
    expect(runtimes).not.toContain('>Agent Runtimes</h3>')
    expect(nav).toContain("monitor: 'monitor'")
  })
})
