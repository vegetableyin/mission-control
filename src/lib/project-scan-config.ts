import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'

export interface ProjectScanConfig {
  roots: string[]
  maxDepth: number
  scanTimeoutMs: number
  gitCommandTimeoutMs: number
  defaultStaleDays: number
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

function defaultScanRoot(): string {
  if (process.platform === 'win32') return path.join(path.parse(process.cwd()).root, 'Work')
  return path.resolve(process.cwd(), '..')
}

export function getProjectScanConfig(env: NodeJS.ProcessEnv = process.env): ProjectScanConfig {
  const rawRoots = env.MC_PROJECT_SCAN_ROOTS?.trim()
  const roots = (rawRoots ? rawRoots.split(path.delimiter) : [defaultScanRoot()])
    .map((root) => path.resolve(root.trim()))
    .filter(Boolean)
  return {
    roots: [...new Set(roots)],
    maxDepth: positiveInteger(env.MC_PROJECT_SCAN_MAX_DEPTH, 2, 5),
    scanTimeoutMs: positiveInteger(env.MC_PROJECT_SCAN_TIMEOUT_MS, 30_000, 300_000),
    gitCommandTimeoutMs: positiveInteger(env.MC_GIT_COMMAND_TIMEOUT_MS, 5_000, 60_000),
    defaultStaleDays: positiveInteger(env.MC_DEFAULT_STALE_DAYS, 7, 3650),
  }
}

function comparable(value: string): string {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(comparable(root), comparable(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function resolveAllowedProjectPath(candidate: string, roots: string[]): Promise<string> {
  if (!candidate || candidate.includes('\0')) throw new Error('Invalid project path')
  const absolute = path.resolve(candidate)
  const allowedLexically = roots.some((root) => isPathWithinRoot(absolute, root))
  if (!allowedLexically) throw new Error('Project path is outside configured scan roots')

  const [resolvedCandidate, resolvedRoots] = await Promise.all([
    realpath(absolute),
    Promise.all(roots.map(async (root) => realpath(root).catch(() => path.resolve(root)))),
  ])
  if (!resolvedRoots.some((root) => isPathWithinRoot(resolvedCandidate, root))) {
    throw new Error('Project path escapes configured scan roots')
  }
  const info = await stat(resolvedCandidate)
  if (!info.isDirectory()) throw new Error('Project path is not a directory')
  return resolvedCandidate
}

export function normalizeProjectPath(value: string): string {
  const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
