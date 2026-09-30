import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MadoInvocation } from '../args.js'
import { CliError } from '../errors.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { withForegroundNotice } from './foreground-notice.js'

const MAX_RESPONSE_BYTES = 1024 * 1024

type SpawnSidecar = (
  command: string, args: string[], options: { stdio: 'pipe'; windowsHide: true; shell: false },
) => ChildProcessWithoutNullStreams

export interface MadoEnvironment {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  spawnProcess: SpawnSidecar
}

function sidecarRequest(invocation: MadoInvocation): Record<string, unknown> {
  switch (invocation.action) {
    case 'health':
      return { action: 'health' }
    case 'list-targets':
      return { action: 'list_targets' }
    case 'capture':
    case 'read-text':
      return { action: invocation.action.replace('-', '_'), target: invocation.target }
    case 'find-template':
    case 'wait-template':
      return {
        action: invocation.action.replace('-', '_'), target: invocation.target,
        template: resolve(invocation.template), min_score: invocation.minScore,
        ...(invocation.timeoutMs === undefined ? {} : { timeout_ms: invocation.timeoutMs }),
      }
    case 'click':
      return {
        action: 'click', target: invocation.target, x: invocation.x, y: invocation.y,
        route: invocation.route.replace('-', '_'), expected_hash: invocation.expectedHash,
      }
  }
}

function sidecarOptions(environment: MadoEnvironment): { executable: string; modelArgs: string[] } {
  if (environment.platform !== 'win32') {
    throw new CliError('ENOTSUPPORTED', 'MadoPilot sidecar currently supports Windows only')
  }
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'elftia-mado-pilot-sidecar.exe')
  const configured = environment.env.ELFTIA_MADO_PILOT_SIDECAR
  if (configured && !isAbsolute(configured)) {
    throw new CliError('EUSAGE', 'ELFTIA_MADO_PILOT_SIDECAR must be an absolute executable path')
  }
  const executable = configured ?? bundled
  if (!existsSync(executable)) {
    throw new CliError('ENOTSUPPORTED', 'MadoPilot sidecar executable was not found; install the native bundle or set ELFTIA_MADO_PILOT_SIDECAR')
  }
  const modelRoot = environment.env.ELFTIA_MADO_PILOT_MODEL_ROOT
  const runtimePath = environment.env.ELFTIA_MADO_PILOT_RUNTIME_PATH
  if (Boolean(modelRoot) !== Boolean(runtimePath)) {
    throw new CliError('EUSAGE', 'set both MadoPilot OCR model root and runtime path')
  }
  if (modelRoot && runtimePath) {
    if (!isAbsolute(modelRoot) || !isAbsolute(runtimePath)) {
      throw new CliError('EUSAGE', 'MadoPilot OCR paths must be absolute')
    }
    return { executable, modelArgs: ['--model-root', modelRoot, '--runtime-path', runtimePath] }
  }
  const bundledModels = join(dirname(executable), 'models')
  const bundledRuntime = join(dirname(executable), 'onnxruntime.dll')
  if (existsSync(bundledModels) && existsSync(bundledRuntime)) {
    return { executable, modelArgs: ['--model-root', bundledModels, '--runtime-path', bundledRuntime] }
  }
  return { executable, modelArgs: [] }
}

function deadlineMs(invocation: MadoInvocation): number {
  if (invocation.action === 'wait-template') return (invocation.timeoutMs ?? 10000) + 15000
  return 30000
}

function parseResponse(output: string, exitCode: number | null): Record<string, unknown> | unknown[] {
  let response: unknown
  try {
    response = JSON.parse(output.trim())
  } catch {
    throw new CliError('EBACKEND', 'MadoPilot sidecar returned invalid JSON')
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new CliError('EBACKEND', 'MadoPilot sidecar returned an invalid response')
  }
  const envelope = response as Record<string, unknown>
  if (envelope.ok === false && exitCode !== 0) {
    const error = envelope.error
    if (error && typeof error === 'object' && (error as Record<string, unknown>).code === 'EINPUT') {
      const detail = error as Record<string, unknown>
      if (!detail.receipt || typeof detail.receipt !== 'object') {
        throw new CliError('EBACKEND', 'MadoPilot partial input receipt was invalid')
      }
      return { input_complete: false, receipt: detail.receipt, before: detail.before }
    }
    const message = error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string'
      ? (error as { message: string }).message : 'MadoPilot operation failed'
    throw new CliError('EBACKEND', message)
  }
  if (envelope.ok !== true || exitCode !== 0 || !envelope.data || typeof envelope.data !== 'object') {
    throw new CliError('EBACKEND', 'MadoPilot sidecar response or exit code was inconsistent')
  }
  return envelope.data as Record<string, unknown> | unknown[]
}

function invokeSidecar(
  executable: string, args: string[], request: Record<string, unknown>,
  timeout: number, spawnProcess: SpawnSidecar,
): Promise<Record<string, unknown> | unknown[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProcess(executable, args, { stdio: 'pipe', windowsHide: true, shell: false })
    } catch {
      rejectPromise(new CliError('EBACKEND', 'could not start MadoPilot sidecar'))
      return
    }
    let output = ''
    let settled = false
    let timedOut = false
    let overflow = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeout)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > MAX_RESPONSE_BYTES) { overflow = true; child.kill() }
    })
    child.stderr.on('data', () => { /* Diagnostics may contain private window data. */ })
    child.stdin.on('error', () => { /* The close event reports the failed process. */ })
    child.on('error', () => {
      if (!settled) { settled = true; clearTimeout(timer); rejectPromise(new CliError('EBACKEND', 'MadoPilot sidecar failed to start')) }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (timedOut) return rejectPromise(new CliError('EBACKEND', 'MadoPilot sidecar timed out'))
      if (overflow) return rejectPromise(new CliError('EBACKEND', 'MadoPilot sidecar response exceeded 1 MiB'))
      if (!output.trim()) return rejectPromise(new CliError('EBACKEND', 'MadoPilot sidecar exited without JSON'))
      try { resolvePromise(parseResponse(output, code)) } catch (error) { rejectPromise(error) }
    })
    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}

export async function runMado(
  invocation: MadoInvocation, deps: CommandDeps,
  environment: MadoEnvironment = { platform: process.platform, env: process.env, spawnProcess: spawn },
): Promise<CommandPayload> {
  const { executable, modelArgs } = sidecarOptions(environment)
  const outputRoot = ensureDir(resolveOutDir(deps, invocation.out))
  const perform = () => invokeSidecar(
    executable, ['--output-root', outputRoot, ...(invocation.action === 'health' || invocation.action === 'read-text' ? modelArgs : [])], sidecarRequest(invocation),
    deadlineMs(invocation), environment.spawnProcess,
  )
  // The `system` route drives the REAL mouse — wrap it in the foreground
  // visibility notice (busy cursor + throttled tray toast).
  const data = invocation.action === 'click' && invocation.route === 'system'
    ? await withForegroundNotice(perform)
    : await perform()
  if (invocation.action === 'list-targets') {
    if (!Array.isArray(data)) throw new CliError('EBACKEND', 'MadoPilot target list was invalid')
    return { ok: true, action: invocation.action, targets: data }
  }
  if (Array.isArray(data)) throw new CliError('EBACKEND', 'MadoPilot action result was invalid')
  if (data.input_complete === false && invocation.action !== 'click') {
    throw new CliError('EBACKEND', 'MadoPilot sidecar returned input state for a non-input action')
  }
  if (invocation.action === 'click') {
    if (data.input_complete === false) {
      return {
        ok: false, action: invocation.action,
        error: { code: 'EINPUT', message: 'MadoPilot input did not complete; inspect the receipt and screen before acting again' },
        receipt: data.receipt, before: data.before,
      }
    }
    if (data.input_complete !== true) throw new CliError('EBACKEND', 'MadoPilot click receipt was invalid')
  }
  return { ...data, ok: true, action: invocation.action }
}
