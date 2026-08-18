import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { CliError, ERROR_CODES, type ErrorCode } from '../errors.js'

const execFileAsync = promisify(execFile)

export const POWERSHELL_BIN = 'powershell.exe'

/** Mandatory script-channel flags (design D2): profiles can print noise or
 * change encodings, which would break the JSON channel. */
export const PS_BASE_FLAGS: readonly string[] = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
]

export interface ShellRunner {
  /** Run a .ps1 from src/platform/windows/scripts (copied to dist on build)
   * and return its parsed stdout JSON. Throws CliError on any failure. */
  run(
    scriptName: string,
    args: ReadonlyArray<string | number>,
    opts?: { timeoutMs?: number },
  ): Promise<Record<string, unknown>>
  /** Cheap availability probe (PS version + elevation) via -Command. */
  probe(): Promise<{ version: string; elevated: boolean; latencyMs: number }>
}

const scriptsDir = fileURLToPath(new URL('./windows/scripts/', import.meta.url))

export function scriptPath(scriptName: string): string {
  return join(scriptsDir, scriptName)
}

interface ScriptErrorPayload {
  code?: unknown
  message?: unknown
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

function excerpt(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

function parseScriptJson(stdout: string, scriptName: string): Record<string, unknown> {
  const text = stripBom(stdout).trim()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new CliError(
      'EBACKEND',
      `backend script "${scriptName}" produced unparseable output: ${excerpt(text)}`,
    )
  }
}

function cliErrorFromPayload(
  payload: ScriptErrorPayload,
  scriptName: string,
): CliError | undefined {
  if (typeof payload.code !== 'string' || typeof payload.message !== 'string') {
    return undefined
  }
  const code = (ERROR_CODES as readonly string[]).includes(payload.code)
    ? (payload.code as ErrorCode)
    : 'EBACKEND'
  return new CliError(code, `backend script "${scriptName}": ${payload.message}`)
}

interface ExecErrorShape extends Error {
  code?: string | number
  stdout?: string
  stderr?: string
  killed?: boolean
}

function mapExecError(err: ExecErrorShape, scriptName: string): CliError {
  if (err.code === 'ENOENT') {
    return new CliError(
      'EBACKEND',
      'PowerShell (powershell.exe) was not found on PATH — the Windows backend requires Windows PowerShell 5.1+',
    )
  }
  // A script that failed on purpose prints its JSON error before exiting non-0.
  if (typeof err.stdout === 'string' && stripBom(err.stdout).trim() !== '') {
    try {
      const parsed = JSON.parse(stripBom(err.stdout).trim()) as Record<string, unknown>
      if (parsed.ok === false) {
        const mapped = cliErrorFromPayload(parsed.error as ScriptErrorPayload, scriptName)
        if (mapped !== undefined) {
          return mapped
        }
      }
    } catch {
      // fall through to the generic message
    }
  }
  const stderrTail = typeof err.stderr === 'string' ? excerpt(err.stderr) : ''
  const detail =
    stderrTail !== ''
      ? stderrTail
      : err.killed === true
        ? 'timed out'
        : excerpt(err.message)
  return new CliError('EBACKEND', `backend script "${scriptName}" failed: ${detail}`)
}

export function createShellRunner(): ShellRunner {
  return {
    async run(scriptName, args, opts) {
      const argv = [
        ...PS_BASE_FLAGS,
        '-File',
        scriptPath(scriptName),
        ...args.map((a) => String(a)),
      ]
      let stdout: string
      try {
        const result = await execFileAsync(POWERSHELL_BIN, argv, {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          timeout: opts?.timeoutMs ?? 30_000,
        })
        stdout = result.stdout
      } catch (err) {
        throw mapExecError(err as ExecErrorShape, scriptName)
      }
      const json = parseScriptJson(stdout, scriptName)
      if (json.ok === false) {
        const mapped = cliErrorFromPayload(json.error as ScriptErrorPayload, scriptName)
        throw mapped ?? new CliError('EBACKEND', `backend script "${scriptName}" failed`)
      }
      return json
    },

    async probe() {
      const started = Date.now()
      const script =
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
        '$o = [ordered]@{ version = $PSVersionTable.PSVersion.ToString(); ' +
        'elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]' +
        '::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }; ' +
        '[Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress))'
      let stdout: string
      try {
        const result = await execFileAsync(
          POWERSHELL_BIN,
          [...PS_BASE_FLAGS, '-Command', script],
          { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true, timeout: 15_000 },
        )
        stdout = result.stdout
      } catch (err) {
        throw mapExecError(err as ExecErrorShape, 'probe')
      }
      const latencyMs = Date.now() - started
      let parsed: { version?: unknown; elevated?: unknown }
      try {
        parsed = JSON.parse(stripBom(stdout).trim()) as { version?: unknown; elevated?: unknown }
      } catch {
        throw new CliError('EBACKEND', `PowerShell probe produced unparseable output: ${excerpt(stdout)}`)
      }
      if (typeof parsed.version !== 'string') {
        throw new CliError('EBACKEND', 'PowerShell probe output is missing the version field')
      }
      return {
        version: parsed.version,
        elevated: parsed.elevated === true,
        latencyMs,
      }
    },
  }
}
