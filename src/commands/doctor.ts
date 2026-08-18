import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Invocation } from '../args.js'
import { toCliError } from '../errors.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import { isPngMagic, readPngDims } from '../png-dims.js'
import type { CommandDeps, CommandPayload } from './deps.js'

/** CJK + emoji + accents fixture proving the script channel stays UTF-8. */
export const DOCTOR_UTF8_FIXTURE = '你好 🌏 naïve ✓'

interface DoctorCheck {
  name: string
  ok: boolean
  [detail: string]: unknown
}

function failed(name: string, err: unknown): DoctorCheck {
  const cliErr = toCliError(err)
  return { name, ok: false, error: `${cliErr.code}: ${cliErr.message}` }
}

/**
 * doctor: non-destructive self-tests only. It never clicks, types, scrolls,
 * drags, or moves windows — the input check re-sets the cursor to the position
 * it just read.
 */
export async function runDoctor(
  _inv: Extract<Invocation, { command: 'doctor' }>,
  deps: CommandDeps,
): Promise<CommandPayload> {
  const checks: DoctorCheck[] = []

  // 1. PowerShell availability + version + measured spawn latency + elevation.
  try {
    const probe = await deps.backend.probe({ echo: DOCTOR_UTF8_FIXTURE })
    checks.push({
      name: 'powershell',
      ok: true,
      version: probe.version,
      latencyMs: probe.latencyMs,
      elevated: probe.elevated,
    })
    // 2. UTF-8 round-trip through the -File script channel.
    checks.push({
      name: 'utf8-echo',
      ok: probe.echo === DOCTOR_UTF8_FIXTURE,
      fixture: DOCTOR_UTF8_FIXTURE,
      received: probe.echo,
    })
  } catch (err) {
    checks.push(failed('powershell', err))
    checks.push({ name: 'utf8-echo', ok: false, error: 'skipped: PowerShell channel unavailable' })
  }

  // 3. Screenshot capture + read-back verification.
  try {
    const dir = ensureDir(resolveOutDir(deps))
    const img = await deps.backend.captureScreen({ outPath: join(dir, 'doctor.png') })
    const buf = await readFile(img.path)
    const magic = isPngMagic(buf)
    const dims = readPngDims(buf)
    const dimsMatch =
      dims !== null && dims.width === img.width && dims.height === img.height
    checks.push({
      name: 'screenshot',
      ok: magic && dims !== null && dimsMatch,
      path: img.path,
      width: img.width,
      height: img.height,
      pngMagic: magic,
      dimsParsed: dims !== null,
      dimsMatch,
    })
  } catch (err) {
    checks.push(failed('screenshot', err))
  }

  // 4. Input round-trip: read cursor, set it to the SAME position, read again.
  // Verification tolerates <=4px drift so a live user's hand moving the mouse
  // during the ~1s check window does not flake the result; the injected write
  // still targets the exact position that was read.
  try {
    const before = await deps.backend.getState()
    await deps.backend.sendInput({ kind: 'move', x: before.cursor.x, y: before.cursor.y })
    const after = await deps.backend.getState()
    const driftX = Math.abs(after.cursor.x - before.cursor.x)
    const driftY = Math.abs(after.cursor.y - before.cursor.y)
    const same = driftX <= 4 && driftY <= 4
    checks.push({
      name: 'input-roundtrip',
      ok: same,
      x: before.cursor.x,
      y: before.cursor.y,
      readback: { x: after.cursor.x, y: after.cursor.y },
      drift: { x: driftX, y: driftY },
    })
  } catch (err) {
    checks.push(failed('input-roundtrip', err))
  }

  const allOk = checks.every((c) => c.ok)
  return { ok: allOk, os: deps.backend.os, checks }
}
