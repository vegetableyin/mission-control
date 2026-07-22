import { expect, test } from '@playwright/test'
import path from 'node:path'
import { API_KEY_HEADER, deleteTestProject } from './helpers'

test.describe('Project inventory and local discovery', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) await deleteTestProject(request, id).catch(() => {})
  })

  test('discovery requires authentication', async ({ request }) => {
    expect((await request.get('/api/projects/discovery')).status()).toBe(401)
    expect((await request.post('/api/projects/scan', { data: {} })).status()).toBe(401)
  })

  test('discovers deterministic fixtures without importing them automatically', async ({ request }) => {
    const before = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    const beforeIds = (await before.json()).projects.map((project: { id: number }) => project.id)
    const discovery = await request.get('/api/projects/discovery', { headers: API_KEY_HEADER })
    expect(discovery.status()).toBe(200)
    const body = await discovery.json()
    expect(body.maxDepth).toBe(2)
    expect(body.candidates.map((candidate: { name: string }) => candidate.name)).toEqual(
      expect.arrayContaining(['中文 空格项目', 'python-project']),
    )
    const after = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    expect((await after.json()).projects.map((project: { id: number }) => project.id)).toEqual(beforeIds)
  })

  test('imports, scans, edits, archives, restores, and rejects duplicate paths', async ({ request }) => {
    const discovery = await request.get('/api/projects/discovery', { headers: API_KEY_HEADER })
    const candidates = (await discovery.json()).candidates as Array<{ name: string; localPath: string; projectType: string }>
    const candidate = candidates.find((item) => item.name === '中文 空格项目')
    expect(candidate).toBeDefined()

    const create = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: {
        name: `Inventory E2E ${Date.now()}`,
        ticket_prefix: `I${String(Date.now()).slice(-7)}`,
        local_path: candidate!.localPath,
        project_type: candidate!.projectType,
        status: 'in_progress',
        next_action: 'Verify local inventory',
      },
    })
    expect(create.status()).toBe(201)
    const project = (await create.json()).project
    cleanup.push(project.id)
    expect(path.basename(project.local_path)).toBe('中文 空格项目')

    const duplicate = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: `Duplicate ${Date.now()}`, ticket_prefix: `D${String(Date.now()).slice(-7)}`, local_path: candidate!.localPath },
    })
    expect(duplicate.status()).toBe(409)

    const scan = await request.post('/api/projects/scan', { headers: API_KEY_HEADER, data: { projectId: project.id } })
    expect(scan.status()).toBe(200)
    const scanned = (await scan.json()).project
    expect(scanned.health_status).toBe('healthy')
    expect(scanned.last_scan_at).toBeGreaterThan(0)

    const disable = await request.patch(`/api/projects/${project.id}`, {
      headers: API_KEY_HEADER,
      data: { scan_enabled: false, next_action: 'Manual follow-up' },
    })
    expect(disable.status()).toBe(200)
    expect((await disable.json()).project.scan_enabled).toBe(false)
    expect((await request.post('/api/projects/scan', { headers: API_KEY_HEADER, data: { projectId: project.id } })).status()).toBe(409)

    expect((await request.delete(`/api/projects/${project.id}`, { headers: API_KEY_HEADER })).status()).toBe(200)
    const archived = await request.get(`/api/projects/${project.id}`, { headers: API_KEY_HEADER })
    expect((await archived.json()).project.status).toBe('archived')

    const restore = await request.patch(`/api/projects/${project.id}`, {
      headers: API_KEY_HEADER,
      data: { archived: false, status: 'paused', scan_enabled: true },
    })
    expect(restore.status()).toBe(200)
    expect((await restore.json()).project).toMatchObject({ archived: false, status: 'paused', scan_enabled: true })

    const detail = await request.get(`/api/projects/${project.id}`, { headers: API_KEY_HEADER })
    expect(detail.status()).toBe(200)
    expect((await detail.json()).scan_history).toHaveLength(1)
  })

  test('renders the Chinese project inventory and deterministic discovery candidates', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('mc-onboarding-dismissed', '1'))
    const login = await page.request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'testpass1234!' },
      headers: { 'x-real-ip': '10.67.0.77' },
    })
    expect(login.ok()).toBe(true)

    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
    await expect(page.getByText('项目台账', { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: '扫描工作目录', exact: true }).click()
    await expect(page.getByText('中文 空格项目', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('python-project', { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await page.locator('main').innerText()).not.toMatch(/projectsOverview\.[A-Za-z][\w.]+/)
  })
})
