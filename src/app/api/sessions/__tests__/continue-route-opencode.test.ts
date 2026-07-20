import { describe, expect, it, vi, beforeEach } from 'vitest'
import { access, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { POST } from '@/app/api/sessions/continue/route'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async (_command: string, _args: string[]) => ({ stdout: '', stderr: '', code: 0 })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
}))

vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: vi.fn(() => null),
}))

vi.mock('@/lib/command', () => ({
  runCommand: mocks.runCommand,
}))

vi.mock('@/lib/opencode-sessions', () => ({
  getOpenCodeExecutable: vi.fn(() => '/custom/bin/opencode'),
}))

vi.mock('@/lib/executable-discovery', () => ({
  detectBinary: vi.fn(() => ({
    installed: true,
    version: 'codex-cli 0.116.0',
    resolvedBin: 'C:\\tools\\codex.ps1',
  })),
}))

describe('OpenCode session continue route', () => {
  beforeEach(() => {
    mocks.runCommand.mockClear()
  })

  it('invokes the OpenCode CLI with the resume command for kind=opencode', async () => {
    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })
    const response = await POST(request as any)
    expect(response.status).not.toBe(400)
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/custom/bin/opencode',
      ['run', '--session', 'ses_open_1', 'continue'],
      expect.objectContaining({ timeoutMs: 180000 }),
    )
  })

  it('surfaces OpenCode runtime failures as a 500 error', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('Model not found: anthropic/claude-opus-4.5'))

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })

    const response = await POST(request as any)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('Model not found')
  })

  it('uses the detected Codex shim and cleans its temporary output file', async () => {
    let outputPath = ''
    mocks.runCommand.mockImplementationOnce(async (_command, args) => {
      outputPath = args[args.indexOf('-o') + 1]
      await writeFile(outputPath, 'continued successfully', 'utf8')
      return { stdout: '', stderr: '', code: 0 }
    })

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'codex-cli', id: 'codex-session-1', prompt: 'continue' }),
    })
    const response = await POST(request as any)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reply: 'continued successfully' })
    expect(mocks.runCommand).toHaveBeenCalledWith(
      'C:\\tools\\codex.ps1',
      expect.arrayContaining(['exec', 'resume', 'codex-session-1']),
      expect.objectContaining({ timeoutMs: 180000 }),
    )
    expect(path.dirname(outputPath)).toBe(os.tmpdir())
    await expect(access(outputPath)).rejects.toThrow()
  })

  it('cleans Codex temporary output even when the CLI fails', async () => {
    let outputPath = ''
    mocks.runCommand.mockImplementationOnce(async (_command, args) => {
      outputPath = args[args.indexOf('-o') + 1]
      await writeFile(outputPath, 'partial response', 'utf8')
      throw new Error('Codex failed')
    })

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'codex-cli', id: 'codex-session-2', prompt: 'continue' }),
    })
    const response = await POST(request as any)

    expect(response.status).toBe(500)
    expect(path.dirname(outputPath)).toBe(os.tmpdir())
    await expect(access(outputPath)).rejects.toThrow()
  })
})
