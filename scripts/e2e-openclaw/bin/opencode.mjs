#!/usr/bin/env node

const args = process.argv.slice(2)

if (args[0] === '--version') {
  process.stdout.write('opencode 1.4.3\n')
  process.exit(0)
}

if (args[0] !== 'run') {
  process.stderr.write(`opencode mock: unsupported args: ${args.join(' ')}\n`)
  process.exit(0)
}

let session = ''
let prompt = ''
for (let index = 1; index < args.length; index += 1) {
  if (args[index] === '--session') {
    session = args[index + 1] || ''
    index += 1
  } else if (args[index] === '--prompt') {
    prompt = args[index + 1] || ''
    index += 1
  } else {
    prompt = args[index]
  }
}

if (session !== 'ses_e2e_1') {
  process.stderr.write(`Session not found: ${session}\n`)
  process.exit(1)
}

process.stdout.write(prompt === 'say exactly CONTINUE_OK and nothing else'
  ? 'CONTINUE_OK\n'
  : `OpenCode session ${session} continued: ${prompt}\n`)
