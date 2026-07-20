import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import { defaultLocale } from '@/i18n/config'
import { ESSENTIAL_PANEL_IDS, isEssentialPanel } from '@/lib/interface-mode'

function flatten(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child)
      ? flatten(child as Record<string, unknown>, path)
      : [path]
  })
}

describe('essential interface baseline', () => {
  it('defaults to simplified Chinese', () => {
    expect(defaultLocale).toBe('zh')
  })

  it('exposes exactly the eight requested Essential destinations', () => {
    expect(ESSENTIAL_PANEL_IDS).toEqual(['overview', 'projects', 'tasks', 'codex', 'cron', 'attention', 'activity', 'settings'])
    expect(isEssentialPanel('memory')).toBe(false)
  })

  it('keeps English and Chinese translation keys aligned', () => {
    expect(flatten(zh).sort()).toEqual(flatten(en).sort())
  })

  it('keeps Windows production startup on the cross-platform local server wrapper', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const wrapper = readFileSync(join(process.cwd(), 'scripts/run-next-server.mjs'), 'utf8')
    expect(pkg.scripts.start).toContain('node scripts/run-next-server.mjs start')
    expect(pkg.scripts.start).not.toContain('${PORT:-')
    expect(wrapper).toContain("'127.0.0.1'")
  })

  it('keeps hidden routes reachable and persists mode changes through settings', () => {
    const router = readFileSync(join(process.cwd(), 'src/app/[[...panel]]/page.tsx'), 'utf8')
    const settings = readFileSync(join(process.cwd(), 'src/components/panels/settings-panel.tsx'), 'utf8')
    expect(router).toContain("interfaceMode === 'essential' && !isEssentialPanel(tab)")
    expect(router).toContain("tp('availableInFullMode'")
    expect(settings).toContain("'general.interface_mode': mode")
    expect(settings).toContain('ESSENTIAL_PANEL_IDS')
  })

  it('renders explicit dashboard empty states instead of fabricated data', () => {
    const dashboard = readFileSync(join(process.cwd(), 'src/components/dashboard/essential-dashboard.tsx'), 'utf8')
    expect(dashboard).toContain("t('attention.empty')")
    expect(dashboard).toContain("t('projects.empty')")
    expect(dashboard).toContain("t('codex.empty')")
    expect(dashboard).toContain("t('activity.empty')")
  })
})
