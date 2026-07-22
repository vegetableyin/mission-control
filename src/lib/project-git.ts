import { runCommand } from './command'

export interface GitCommandResult { stdout: string; stderr: string; code: number | null }
export type GitCommandRunner = (args: string[], cwd: string, timeoutMs: number) => Promise<GitCommandResult>

const allowedCommands = new Set(['status', 'branch', 'rev-parse', 'log', 'remote', 'rev-list'])

export const defaultGitCommandRunner: GitCommandRunner = async (args, cwd, timeoutMs) => {
  if (!args.length || !allowedCommands.has(args[0])) throw new Error('Disallowed Git command')
  return runCommand('git', args, { cwd, timeoutMs })
}

export interface GitProjectMetadata {
  isGit: boolean
  accessible: boolean
  branch: string | null
  headSha: string | null
  lastCommitAt: number | null
  lastCommitTitle: string | null
  dirty: boolean
  modifiedCount: number
  untrackedCount: number
  aheadCount: number | null
  behindCount: number | null
  detachedHead: boolean
  hasOrigin: boolean
  originUrl: string | null
  upstream: string | null
  error: string | null
  timedOut: boolean
}

async function optionalRun(runner: GitCommandRunner, args: string[], cwd: string, timeoutMs: number): Promise<string | null> {
  try {
    return (await runner(args, cwd, timeoutMs)).stdout.trim()
  } catch {
    return null
  }
}

export async function readGitProjectMetadata(
  cwd: string,
  timeoutMs: number,
  runner: GitCommandRunner = defaultGitCommandRunner,
): Promise<GitProjectMetadata> {
  const empty: GitProjectMetadata = {
    isGit: false, accessible: false, branch: null, headSha: null, lastCommitAt: null,
    lastCommitTitle: null, dirty: false, modifiedCount: 0, untrackedCount: 0,
    aheadCount: null, behindCount: null, detachedHead: false, hasOrigin: false,
    originUrl: null, upstream: null, error: null, timedOut: false,
  }
  try {
    const inside = await runner(['rev-parse', '--is-inside-work-tree'], cwd, timeoutMs)
    if (inside.stdout.trim() !== 'true') return empty
    const [statusResult, branchResult, headResult, logResult] = await Promise.all([
      runner(['status', '--porcelain=v1', '--untracked-files=all'], cwd, timeoutMs),
      runner(['branch', '--show-current'], cwd, timeoutMs),
      runner(['rev-parse', 'HEAD'], cwd, timeoutMs),
      runner(['log', '-1', '--format=%ct%x00%s'], cwd, timeoutMs),
    ])
    const statusLines = statusResult.stdout.split(/\r?\n/).filter(Boolean)
    const untrackedCount = statusLines.filter((line) => line.startsWith('??')).length
    const modifiedCount = statusLines.length - untrackedCount
    const branch = branchResult.stdout.trim() || null
    const logParts = logResult.stdout.trim().split('\0')
    const originUrl = await optionalRun(runner, ['remote', 'get-url', 'origin'], cwd, timeoutMs)
    const upstream = await optionalRun(runner, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd, timeoutMs)
    let aheadCount: number | null = null
    let behindCount: number | null = null
    if (upstream) {
      const counts = await optionalRun(runner, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], cwd, timeoutMs)
      const [ahead, behind] = (counts || '').split(/\s+/).map((value) => Number.parseInt(value, 10))
      if (Number.isFinite(ahead) && Number.isFinite(behind)) {
        aheadCount = ahead
        behindCount = behind
      }
    }
    return {
      isGit: true,
      accessible: true,
      branch,
      headSha: headResult.stdout.trim() || null,
      lastCommitAt: Number.isFinite(Number(logParts[0])) ? Number(logParts[0]) : null,
      lastCommitTitle: logParts.slice(1).join('\0').trim() || null,
      dirty: statusLines.length > 0,
      modifiedCount,
      untrackedCount,
      aheadCount,
      behindCount,
      detachedHead: !branch,
      hasOrigin: Boolean(originUrl),
      originUrl,
      upstream,
      error: null,
      timedOut: false,
    }
  } catch (error) {
    const typed = error as Error & { timedOut?: boolean }
    return { ...empty, error: typed.message || 'Git command failed', timedOut: typed.timedOut === true }
  }
}
