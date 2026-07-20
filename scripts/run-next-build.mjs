import { spawn } from 'node:child_process'
import path from 'node:path'

const repoRoot = process.cwd()
const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
const artifactScript = path.join(repoRoot, 'scripts', 'prepare-standalone-artifact.mjs')
const requestedBundler = String(process.env.MC_BUILD_BUNDLER || '').trim().toLowerCase()
const bundler = requestedBundler || (process.platform === 'win32' ? 'turbopack' : 'webpack')
const timeoutMs = Number(process.env.MC_BUILD_TIMEOUT_MS || 15 * 60 * 1000)

if (!['turbopack', 'webpack'].includes(bundler)) {
  process.stderr.write(`Invalid MC_BUILD_BUNDLER: ${requestedBundler}. Use "turbopack" or "webpack".\n`)
  process.exit(2)
}

if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000) {
  process.stderr.write('MC_BUILD_TIMEOUT_MS must be a number of at least 60000.\n')
  process.exit(2)
}

function run(command, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    })
    let timedOut = false
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true
          process.stderr.write(`Build timed out after ${timeout}ms; terminating process ${child.pid}.\n`)
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
          } else {
            child.kill('SIGTERM')
          }
        }, timeout)
      : undefined

    child.once('error', (error) => {
      if (timer) clearTimeout(timer)
      process.stderr.write(`${error.message}\n`)
      resolve({ code: 1, timedOut })
    })
    child.once('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, timedOut })
    })
  })
}

const startedAt = Date.now()
const nextArgs = [nextBin, 'build', ...(bundler === 'webpack' ? ['--webpack'] : [])]
process.stdout.write(
  `Mission Control build: node=${process.version} platform=${process.platform} bundler=${bundler} timeoutMs=${timeoutMs}\n`,
)

const build = await run(process.execPath, nextArgs, timeoutMs)
if (build.timedOut) process.exit(124)
if (build.code !== 0) {
  process.stderr.write(`Next.js build failed with exit code ${build.code}.\n`)
  process.exit(build.code)
}

const artifact = await run(process.execPath, [artifactScript])
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
process.stdout.write(`Mission Control build completed in ${elapsedSeconds}s with exit code ${artifact.code}.\n`)
process.exit(artifact.code)
