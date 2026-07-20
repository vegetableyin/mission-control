#!/usr/bin/env node

const args = process.argv.slice(2)

if (args[0] === '--version') {
  process.stdout.write('openclaw 2026.3.2\n')
  process.exit(0)
}

if (args[0] === '-c') {
  const command = args[1] || ''
  process.stdout.write(command.startsWith('sessions_spawn')
    ? 'Session created: mock-openclaw-session\n'
    : 'ok\n')
  process.exit(0)
}

process.stderr.write(`openclaw mock: unsupported args: ${args.join(' ')}\n`)
