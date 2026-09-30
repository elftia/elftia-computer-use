import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Foreground-operation visibility for engine-level actions the PowerShell
 * scripts cannot wrap (Cua `delivery_mode:"foreground"`, Mado `system` route):
 * swaps the system arrow cursor to arrow+hourglass and fires a throttled tray
 * toast around the action. The core scripts (input.ps1 / clipboard-type.ps1)
 * wrap themselves; this module covers everything that goes through JS.
 *
 * Opt out machine/session-wide with ELFTIA_CU_FOREGROUND_NOTICE=0.
 */

const SCRIPT = join(
  fileURLToPath(new URL('../platform/windows/scripts/foreground-notice.ps1', import.meta.url)),
)

export function foregroundNoticeEnabled(): boolean {
  return process.platform === 'win32' && process.env.ELFTIA_CU_FOREGROUND_NOTICE !== '0'
}

function runNoticePhase(phase: 'begin' | 'end'): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Phase', phase],
      { stdio: 'ignore', windowsHide: true },
    )
    child.on('error', () => resolve())
    child.on('close', () => resolve())
    // A stuck notice must never wedge the action; 8s is generous for a
    // PowerShell cold start plus the toast dwell.
    setTimeout(() => {
      child.kill()
      resolve()
    }, 8000).unref()
  })
}

/** True when a Cua tool call explicitly requests foreground delivery. */
export function cuaArgsWantForeground(args: Record<string, unknown>): boolean {
  const mode = args.delivery_mode
  return mode === 'foreground' || mode === 'Foreground' || mode === 1
}

export async function withForegroundNotice<T>(fn: () => Promise<T>): Promise<T> {
  if (!foregroundNoticeEnabled()) {
    return fn()
  }
  await runNoticePhase('begin')
  try {
    return await fn()
  } finally {
    await runNoticePhase('end')
  }
}
