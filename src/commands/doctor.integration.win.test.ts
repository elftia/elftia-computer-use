import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgv, type Invocation } from '../args.js'
import { WindowsBackend } from '../platform/windows/backend.js'
import type { CommandDeps } from './deps.js'
import { runDoctor } from './doctor.js'

/**
 * Windows-only integration test executing the REAL pipeline end to end:
 * powershell.exe spawn, echo.ps1 UTF-8 round-trip, CopyFromScreen PNG with
 * read-back, and the non-destructive cursor move-to-same-position.
 */
describe.skipIf(process.platform !== 'win32')('doctor on the real Windows backend', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'cucu-doctor-it-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('runs the full non-destructive pipeline and passes on a healthy machine', async () => {
    const parsed = parseArgv(['doctor'])
    if (parsed.kind !== 'command') {
      throw new Error('expected doctor invocation')
    }
    const deps: CommandDeps = {
      backend: new WindowsBackend(),
      cwd,
      now: () => new Date(),
    }
    const payload = await runDoctor(parsed.invocation as Extract<Invocation, { command: 'doctor' }>, deps)
    expect(payload.ok).toBe(true)
    const checks = payload.checks as Array<{ name: string; ok: boolean }>
    expect(checks.map((c) => c.name)).toEqual([
      'powershell',
      'utf8-echo',
      'screenshot',
      'input-roundtrip',
    ])
    for (const check of checks) {
      expect(check.ok, `check ${check.name} failed: ${JSON.stringify(check)}`).toBe(true)
    }
  }, 120_000)
})
