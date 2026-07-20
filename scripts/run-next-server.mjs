#!/usr/bin/env node

import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'start') {
  process.stderr.write('Usage: node scripts/run-next-server.mjs <dev|start>\n')
  process.exit(2)
}

const rawPort = String(process.env.PORT || '3100').trim()
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid PORT: ${rawPort}\n`)
  process.exit(2)
}

const host = String(process.env.MC_HOST || '127.0.0.1').trim()
if (!host) {
  process.stderr.write('MC_HOST must not be empty\n')
  process.exit(2)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
const extraArgs = process.argv.slice(3)

const child = spawn(
  process.execPath,
  [nextBin, mode, '--hostname', host, '--port', String(port), ...extraArgs],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  },
)

child.on('error', (error) => {
  process.stderr.write(`Failed to start Next.js: ${error.message}\n`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`Next.js exited from signal ${signal}\n`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
