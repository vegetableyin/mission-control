import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface BinaryDetectionResult {
  installed: boolean
  version: string | null
  resolvedBin: string | null
}

export interface BinaryInvocation {
  command: string
  args: string[]
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function getBinaryInvocation(
  binaryPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): BinaryInvocation {
  if (platform !== 'win32') return { command: binaryPath, args }

  const extension = path.extname(binaryPath).toLowerCase()
  if (extension === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', binaryPath, ...args],
    }
  }

  if (extension === '.cmd' || extension === '.bat') {
    const commandLine = [binaryPath, ...args].map(quoteCmdArg).join(' ')
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
    }
  }

  return { command: binaryPath, args }
}

function versionFromOutput(stdout: Buffer | string | null, stderr: Buffer | string | null): string | null {
  const rawOutput = `${stdout?.toString() || ''}\n${stderr?.toString() || ''}`.trim()
  if (!rawOutput) return null
  return rawOutput
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trim().startsWith('['))
    ?.trim() || null
}

function windowsPathCandidates(bin: string): string[] {
  if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) return [bin]

  const candidates: string[] = []
  for (const query of [`${bin}.exe`, `${bin}.cmd`, `${bin}.ps1`, bin]) {
    const result = spawnSync('where.exe', [query], { stdio: 'pipe', timeout: 3000 })
    if (result.status !== 0) continue
    const matches = (result.stdout?.toString() || '')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    candidates.push(...matches)
  }
  return candidates
}

function unixPathCandidates(bin: string): string[] {
  if (path.isAbsolute(bin) || bin.includes('/')) return [bin]
  return [
    path.join(homedir(), '.local', 'bin', bin),
    path.join('/usr', 'local', 'bin', bin),
    path.join(homedir(), 'Library', 'pnpm', bin),
    path.join(homedir(), '.npm-global', 'bin', bin),
    bin,
  ]
}

export function detectBinary(bins: string[], versionFlag = '--version'): BinaryDetectionResult {
  const discovered = bins.flatMap((bin) => (
    process.platform === 'win32' ? windowsPathCandidates(bin) : unixPathCandidates(bin)
  ))
  const candidates = [...new Set(discovered)]

  for (const binaryPath of candidates) {
    try {
      if ((path.isAbsolute(binaryPath) || binaryPath.includes('/') || binaryPath.includes('\\')) && !existsSync(binaryPath)) {
        continue
      }
      const invocation = getBinaryInvocation(binaryPath, [versionFlag])
      const result = spawnSync(invocation.command, invocation.args, { stdio: 'pipe', timeout: 5000 })
      if (result.status === 0) {
        return {
          installed: true,
          version: versionFromOutput(result.stdout, result.stderr),
          resolvedBin: path.isAbsolute(binaryPath) ? path.resolve(binaryPath) : binaryPath,
        }
      }
    } catch {
      // Continue trying other supported shims and install locations.
    }
  }

  return { installed: false, version: null, resolvedBin: null }
}

export function runDetectedBinary(binaryPath: string, args: string[], timeout = 5000) {
  const invocation = getBinaryInvocation(binaryPath, args)
  return spawnSync(invocation.command, invocation.args, { stdio: 'pipe', timeout })
}
