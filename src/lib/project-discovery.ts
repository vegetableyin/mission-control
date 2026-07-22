import path from 'node:path'
import { readdir, realpath } from 'node:fs/promises'
import { isPathWithinRoot, normalizeProjectPath, resolveAllowedProjectPath, type ProjectScanConfig } from './project-scan-config'

export const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'README.md'] as const
export const PROJECT_SCAN_EXCLUDES = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'target', 'vendor',
  '.venv', 'venv', '__pycache__', 'backups', 'logs', 'temp', 'tmp',
])

export interface ProjectCandidate {
  name: string
  localPath: string
  depth: number
  projectType: string
  isGit: boolean
  markers: string[]
}

function inferProjectType(markers: Set<string>): string {
  if (markers.has('package.json')) return 'node'
  if (markers.has('pyproject.toml')) return 'python'
  if (markers.has('Cargo.toml')) return 'rust'
  if (markers.has('go.mod')) return 'go'
  if (markers.has('pom.xml')) return 'java'
  if (markers.has('.git')) return 'git'
  return 'other'
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || PROJECT_SCAN_EXCLUDES.has(name.toLowerCase())
}

export async function discoverLocalProjects(
  config: ProjectScanConfig,
  registeredPaths: string[] = [],
): Promise<{ candidates: ProjectCandidate[]; roots: string[]; durationMs: number; skippedRegistered: number }> {
  const startedAt = Date.now()
  const deadline = startedAt + config.scanTimeoutMs
  const registered = new Set(registeredPaths.filter(Boolean).map(normalizeProjectPath))
  const candidates = new Map<string, ProjectCandidate>()
  let skippedRegistered = 0

  const scanDirectory = async (directory: string, root: string, depth: number): Promise<void> => {
    if (Date.now() > deadline) throw new Error(`Project discovery timed out after ${config.scanTimeoutMs}ms`)
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    const markerNames = new Set(entries.map((entry) => entry.name))
    const isGit = markerNames.has('.git')
    const markers = PROJECT_MARKERS.filter((marker) => markerNames.has(marker))
    if (isGit || markers.length > 0) {
      const resolved = await resolveAllowedProjectPath(directory, [root])
      const key = normalizeProjectPath(resolved)
      if (registered.has(key)) {
        skippedRegistered += 1
      } else if (!candidates.has(key)) {
        const allMarkers = new Set(markers)
        if (isGit) allMarkers.add('.git' as typeof PROJECT_MARKERS[number])
        candidates.set(key, {
          name: path.basename(resolved),
          localPath: resolved,
          depth,
          projectType: inferProjectType(allMarkers),
          isGit,
          markers: [...(isGit ? ['.git'] : []), ...markers],
        })
      }
    }
    if (depth >= config.maxDepth) return
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || shouldSkipDirectory(entry.name)) continue
      const child = path.join(directory, entry.name)
      let resolvedChild: string
      try {
        resolvedChild = await realpath(child)
      } catch {
        continue
      }
      if (!isPathWithinRoot(resolvedChild, root)) continue
      await scanDirectory(resolvedChild, root, depth + 1)
    }
  }

  const usableRoots: string[] = []
  for (const configuredRoot of config.roots) {
    let root: string
    try {
      root = await realpath(configuredRoot)
    } catch {
      continue
    }
    usableRoots.push(root)
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || shouldSkipDirectory(entry.name)) continue
      const child = await realpath(path.join(root, entry.name)).catch(() => '')
      if (!child || !isPathWithinRoot(child, root)) continue
      await scanDirectory(child, root, 1)
    }
  }

  return {
    candidates: [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    roots: usableRoots,
    durationMs: Date.now() - startedAt,
    skippedRegistered,
  }
}
