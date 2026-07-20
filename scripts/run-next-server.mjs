#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
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
const standaloneServer = path.join(repoRoot, '.next', 'standalone', 'server.js')
const extraArgs = process.argv.slice(3)

if (mode === 'start') {
  try {
    process.loadEnvFile(path.join(repoRoot, '.env'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const useStandalone = mode === 'start' && fs.existsSync(standaloneServer)
const commandArgs = useStandalone
  ? [standaloneServer, ...extraArgs]
  : [nextBin, mode, '--hostname', host, '--port', String(port), ...extraArgs]
const childEnv = {
  ...process.env,
  ...(useStandalone ? { HOSTNAME: host } : {}),
  PORT: String(port),
  MISSION_CONTROL_DATA_DIR: process.env.MISSION_CONTROL_DATA_DIR || path.join(repoRoot, '.data'),
}

const child = spawn(
  process.execPath,
  commandArgs,
  {
    cwd: useStandalone ? path.dirname(standaloneServer) : repoRoot,
    env: childEnv,
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
