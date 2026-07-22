import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocalProjects } from '@/lib/project-discovery'
import { isPathWithinRoot, normalizeProjectPath, resolveAllowedProjectPath, type ProjectScanConfig } from '@/lib/project-scan-config'

describe('safe local project discovery', () => {
  const cleanup: string[] = []
  afterEach(async () => { await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))) })

  async function root() {
    const value = await mkdtemp(path.join(tmpdir(), 'mc-project-discovery-'))
    cleanup.push(value)
    return value
  }

  function config(scanRoot: string, maxDepth = 2): ProjectScanConfig {
    return { roots: [scanRoot], maxDepth, scanTimeoutMs: 5_000, gitCommandTimeoutMs: 1_000, defaultStaleDays: 7 }
  }

  it('supports Windows, Chinese, and space-containing paths', async () => {
    const scanRoot = await root()
    const project = path.join(scanRoot, '中文 项目')
    await mkdir(project)
    await writeFile(path.join(project, 'package.json'), '')
    const result = await discoverLocalProjects(config(scanRoot))
    expect(result.candidates).toEqual([expect.objectContaining({ name: '中文 项目', localPath: project, projectType: 'node' })])
    expect(isPathWithinRoot(path.join(scanRoot, '子目录'), scanRoot)).toBe(true)
    if (process.platform === 'win32') expect(isPathWithinRoot('D:\\Work\\项目', 'D:\\Work')).toBe(true)
  })

  it('honors depth, exclusions, and registered-path deduplication', async () => {
    const scanRoot = await root()
    const first = path.join(scanRoot, 'first')
    const second = path.join(first, 'second')
    const third = path.join(second, 'third')
    const ignored = path.join(scanRoot, 'node_modules', 'dependency')
    await Promise.all([mkdir(third, { recursive: true }), mkdir(ignored, { recursive: true })])
    await Promise.all([
      writeFile(path.join(first, 'README.md'), ''),
      writeFile(path.join(second, 'pyproject.toml'), ''),
      writeFile(path.join(third, 'Cargo.toml'), ''),
      writeFile(path.join(ignored, 'package.json'), ''),
    ])
    const result = await discoverLocalProjects(config(scanRoot, 2), [first])
    expect(result.skippedRegistered).toBe(1)
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['second'])
  })

  it('rejects traversal and symbolic-link escapes', async () => {
    const scanRoot = await root()
    const outside = await root()
    await expect(resolveAllowedProjectPath(path.join(scanRoot, '..', path.basename(outside)), [scanRoot])).rejects.toThrow(/outside configured scan roots/)
    const link = path.join(scanRoot, 'escaped-link')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolveAllowedProjectPath(link, [scanRoot])).rejects.toThrow(/escapes configured scan roots/)
    const result = await discoverLocalProjects(config(scanRoot))
    expect(result.candidates).toHaveLength(0)
  })

  it('normalizes duplicate path spellings without using paths as database ids', async () => {
    const scanRoot = await root()
    expect(normalizeProjectPath(path.join(scanRoot, 'demo', '..', 'demo'))).toBe(normalizeProjectPath(path.join(scanRoot, 'demo')))
  })
})
