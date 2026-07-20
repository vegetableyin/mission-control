import { describe, expect, it } from 'vitest'
import { getBinaryInvocation } from '@/lib/executable-discovery'

describe('getBinaryInvocation', () => {
  it('runs PowerShell shims through a non-interactive PowerShell host on Windows', () => {
    expect(getBinaryInvocation('C:\\tools\\codex.ps1', ['--version'], 'win32')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\tools\\codex.ps1',
        '--version',
      ],
    })
  })

  it('runs cmd shims through cmd.exe on Windows', () => {
    const invocation = getBinaryInvocation('C:\\tools\\codex.cmd', ['--version'], 'win32')
    expect(invocation.command.toLowerCase()).toMatch(/(?:cmd\.exe|\\cmd\.exe)$/)
    expect(invocation.args).toEqual(['/d', '/s', '/c', '"C:\\tools\\codex.cmd" "--version"'])
  })

  it('executes binaries directly on Unix-like systems', () => {
    expect(getBinaryInvocation('/usr/local/bin/codex', ['--version'], 'linux')).toEqual({
      command: '/usr/local/bin/codex',
      args: ['--version'],
    })
  })
})
