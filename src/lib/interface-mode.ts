export type InterfaceMode = 'essential' | 'full'

export const ESSENTIAL_PANEL_IDS = [
  'overview',
  'projects',
  'tasks',
  'codex',
  'cron',
  'attention',
  'activity',
  'settings',
] as const

const essentialPanels = new Set<string>(ESSENTIAL_PANEL_IDS)

export function isEssentialPanel(panel: string): boolean {
  return essentialPanels.has(panel)
}
