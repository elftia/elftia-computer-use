#!/usr/bin/env node
import { parseArgv } from './args.js'
import { createDefaultDeps } from './commands/deps.js'
import { dispatch } from './commands/dispatch.js'
import { toCliError } from './errors.js'
import { HELP_TEXT } from './help.js'
import { writeErrorJson, writeJson } from './json-out.js'
import { VERSION } from './version.js'

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2))
  if (parsed.kind === 'help') {
    process.stdout.write(HELP_TEXT)
    return 0
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  const payload = await dispatch(parsed.invocation, createDefaultDeps())
  writeJson(payload)
  // doctor (and any future command) signals failure via ok:false.
  return payload.ok === false ? 1 : 0
}

main().then(
  (code) => {
    process.exit(code)
  },
  (err) => {
    const cliErr = toCliError(err)
    writeErrorJson(cliErr.code, cliErr.message)
    if (cliErr.code === 'EUSAGE') {
      process.stderr.write('Run "computer-use --help" for usage.\n')
    }
    process.exit(1)
  },
)
