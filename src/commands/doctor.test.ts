import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgv, type Invocation } from '../args.js'
import { CliError } from '../errors.js'
import { FakeBackend } from '../testing/fake-backend.js'
import type { CommandDeps } from './deps.js'
import { DOCTOR_UTF8_FIXTURE, runDoctor } from './doctor.js'

let cwd: string
let backend: FakeBackend

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cucu-doctor-'))
  backend = new FakeBackend()
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function deps(): CommandDeps {
  return { backend, cwd, now: () => new Date(2026, 7, 18, 12, 0, 0, 0) }
}

function doctorInv(): Extract<Invocation, { command: 'doctor' }> {
  const parsed = parseArgv(['doctor'])
  if (parsed.kind !== 'command') {
    throw new Error('expected doctor invocation')
  }
  return parsed.invocation as Extract<Invocation, { command: 'doctor' }>
}

interface CheckShape {
  name: string
  ok: boolean
  [detail: string]: unknown
}

function checksOf(payload: Record<string, unknown>): CheckShape[] {
  return payload.checks as CheckShape[]
}

describe('doctor (mocked backend)', () => {
  it('reports all checks passing on a healthy machine', async () => {
    const payload = await runDoctor(doctorInv(), deps())
    expect(payload.ok).toBe(true)
    expect(checksOf(payload).map((c) => c.name)).toEqual([
      'powershell',
      'utf8-echo',
      'screenshot',
      'input-roundtrip',
    ])
    for (const check of checksOf(payload)) {
      expect(check.ok, `check ${check.name}`).toBe(true)
    }
    const ps = checksOf(payload)[0] as unknown as { version: string; latencyMs: number; elevated: boolean }
    expect(ps.version).toBe('5.1.26100.8875')
    expect(typeof ps.latencyMs).toBe('number')
  })

  it('never injects destructive input — only a move to the same cursor position', async () => {
    await runDoctor(doctorInv(), deps())
    expect(backend.inputEvents).toEqual([{ kind: 'move', x: 512, y: 384 }])
    expect(backend.clipboardTexts).toHaveLength(0)
  })

  it('reports PowerShell unavailability as a failed check (not a crash)', async () => {
    backend = new FakeBackend({
      probeError: new CliError('EBACKEND', 'PowerShell (powershell.exe) was not found on PATH'),
    })
    const payload = await runDoctor(doctorInv(), deps())
    expect(payload.ok).toBe(false)
    const ps = checksOf(payload)[0]
    expect(ps.ok).toBe(false)
    expect(String(ps.error)).toContain('EBACKEND')
    const echo = checksOf(payload)[1]
    expect(echo.ok).toBe(false)
    expect(String(echo.error)).toContain('skipped')
  })

  it('fails the UTF-8 check on a mojibake echo', async () => {
    backend = new FakeBackend({ echoResponse: '??? 🌏' })
    const payload = await runDoctor(doctorInv(), deps())
    expect(payload.ok).toBe(false)
    const echo = checksOf(payload)[1] as unknown as { ok: boolean; fixture: string; received: string }
    expect(echo.ok).toBe(false)
    expect(echo.fixture).toBe(DOCTOR_UTF8_FIXTURE)
    expect(echo.received).toBe('??? 🌏')
  })

  it('verifies the screenshot read-back (magic, dims parsed, dims match)', async () => {
    const payload = await runDoctor(doctorInv(), deps())
    const shot = checksOf(payload)[2] as unknown as {
      ok: boolean
      pngMagic: boolean
      dimsParsed: boolean
      dimsMatch: boolean
    }
    expect(shot.ok).toBe(true)
    expect(shot.pngMagic).toBe(true)
    expect(shot.dimsParsed).toBe(true)
    expect(shot.dimsMatch).toBe(true)
  })

  it('fails the screenshot check when written dims disagree with reported dims', async () => {
    backend = new FakeBackend({
      captureDims: { width: 1920, height: 1080 },
      pngDimsOverride: { width: 640, height: 480 },
    })
    const payload = await runDoctor(doctorInv(), deps())
    expect(payload.ok).toBe(false)
    const shot = checksOf(payload)[2] as unknown as { ok: boolean; dimsMatch: boolean }
    expect(shot.ok).toBe(false)
    expect(shot.dimsMatch).toBe(false)
  })

  it('fails the screenshot check when capture throws', async () => {
    backend = new FakeBackend({ captureError: new CliError('EINPUT', 'capture failed') })
    const payload = await runDoctor(doctorInv(), deps())
    const shot = checksOf(payload)[2]
    expect(shot.ok).toBe(false)
    expect(String(shot.error)).toContain('EINPUT')
  })

  it('fails when the cursor readback moved', async () => {
    backend = new FakeBackend({
      rawState: {
        cursor: { x: 512, y: 384 },
        screen: { width: 1920, height: 1080 },
        activeWindow: {
          id: 1,
          pid: 2,
          title: 't',
          appName: 'a',
          bounds: { x: 0, y: 0, width: 10, height: 10 },
        },
      },
    })
    // getState called twice by doctor; make the second read differ
    const original = backend.getState.bind(backend)
    let calls = 0
    backend.getState = async () => {
      calls += 1
      if (calls === 2) {
        const base = await original()
        return { ...base, cursor: { x: 999, y: 999 } }
      }
      return original()
    }
    const payload = await runDoctor(doctorInv(), deps())
    const input = checksOf(payload)[3]
    expect(input.ok).toBe(false)
    expect(payload.ok).toBe(false)
  })
})
