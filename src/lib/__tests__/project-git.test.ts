import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultGitCommandRunner, readGitProjectMetadata, type GitCommandRunner } from '@/lib/project-git'

describe('read-only project Git metadata', () => {
  const cleanup: string[] = []
  afterEach(() => cleanup.splice(0).forEach((entry) => rmSync(entry, { recursive: true, force: true })))

  function repo() {
    const cwd = mkdtempSync(path.join(tmpdir(), 'mc-project-git-'))
    cleanup.push(cwd)
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'mission-control@example.invalid'], { cwd })
    execFileSync('git', ['config', 'user.name', 'Mission Control Test'], { cwd })
    writeFileSync(path.join(cwd, 'README.md'), 'baseline')
    execFileSync('git', ['add', 'README.md'], { cwd })
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd, stdio: 'ignore' })
    return cwd
  }

  it('reads branch, HEAD, last commit, dirty files, and untracked files', async () => {
    const cwd = repo()
    writeFileSync(path.join(cwd, 'README.md'), 'changed')
    writeFileSync(path.join(cwd, '新文件.txt'), 'untracked')
    const result = await readGitProjectMetadata(cwd, 5_000)
    expect(result).toMatchObject({ isGit: true, accessible: true, dirty: true, modifiedCount: 1, untrackedCount: 1, detachedHead: false })
    expect(result.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(result.lastCommitTitle).toBe('initial commit')
  })

  it('detects detached HEAD', async () => {
    const cwd = repo()
    execFileSync('git', ['checkout', '--detach'], { cwd, stdio: 'ignore' })
    const result = await readGitProjectMetadata(cwd, 5_000)
    expect(result.detachedHead).toBe(true)
    expect(result.branch).toBeNull()
  })

  it('uses only local tracking refs for ahead and behind counts', async () => {
    const calls: string[][] = []
    const runner: GitCommandRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      const stdout = key === 'rev-parse --is-inside-work-tree' ? 'true\n'
        : key.startsWith('status ') ? ''
          : key === 'branch --show-current' ? 'main\n'
            : key === 'rev-parse HEAD' ? `${'a'.repeat(40)}\n`
              : key.startsWith('log ') ? '1700000000\0local commit\n'
                : key === 'remote get-url origin' ? 'https://github.com/example/repo.git\n'
                  : key.includes('@{upstream}') ? 'origin/main\n'
                    : key.startsWith('rev-list ') ? '2 3\n' : ''
      return { stdout, stderr: '', code: 0 }
    }
    const result = await readGitProjectMetadata('D:\\Work\\示例 项目', 5_000, runner)
    expect(result).toMatchObject({ aheadCount: 2, behindCount: 3, upstream: 'origin/main', hasOrigin: true })
    expect(calls.some((args) => ['fetch', 'pull', 'push'].includes(args[0]))).toBe(false)
  })

  it('reports timeouts and rejects disallowed commands', async () => {
    const timeoutRunner: GitCommandRunner = async () => { const error = Object.assign(new Error('timed out'), { timedOut: true }); throw error }
    await expect(readGitProjectMetadata('D:\\Work\\demo', 5, timeoutRunner)).resolves.toMatchObject({ timedOut: true, accessible: false })
    await expect(defaultGitCommandRunner(['fetch'], process.cwd(), 5)).rejects.toThrow('Disallowed Git command')
  })
})
