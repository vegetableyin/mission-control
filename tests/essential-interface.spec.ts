import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

const essentialLabels = ['概览', '项目', '任务', 'Codex', '定时任务', '待处理', '活动记录', '设置']

test.describe('Essential interface', () => {
  test.beforeAll(async ({ request }) => {
    await request.put('/api/settings', {
      headers: API_KEY_HEADER,
      data: { settings: { 'general.interface_mode': 'essential' } },
    })
  })

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.addInitScript(() => window.sessionStorage.setItem('mc-onboarding-dismissed', '1'))
    const login = await page.request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'testpass1234!' },
      headers: { 'x-forwarded-for': '10.67.0.1' },
    })
    expect(login.ok()).toBe(true)
  })

  test('covers Chinese Essential navigation and translation rendering', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.getByRole('heading', { name: '个人驾驶舱' })).toBeVisible()

    for (const label of essentialLabels) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: '智能体', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '记忆', exact: true })).toHaveCount(0)
    expect(await page.locator('main').innerText()).not.toMatch(/\b(?:taskBoard|essentialDashboard|projectsOverview|codexStatus|attentionCenter)\.[A-Za-z][\w.]+\b/)

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByText('界面模式')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /完整模式 Full/ }).click()
    await expect(page.getByRole('button', { name: '记忆', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '记忆', exact: true })).toBeVisible()

    await page.getByRole('button', { name: /精简模式 Essential/ }).click()
    await expect(page.getByRole('button', { name: '记忆', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '记忆', exact: true })).toHaveCount(0)
  })
})
