import type { CuaInvocation } from '../args.js'
import { CliError } from '../errors.js'
import type { CommandDeps, CommandPayload } from './deps.js'

/**
 * Cua Driver one-shot command: in-process SDK (`CuaDriver.create()`), one tool
 * call per process. Multi-step work belongs to `cua-serve`, which keeps one
 * driver instance (and its snapshot/element_token lifecycle) alive across calls.
 */

/** Minimal structural surface of the SDK driver used by this command. */
export interface CuaDriverSurface {
  callTool(name: string, argumentsJson: string): Promise<unknown>
  listToolsJson(): Promise<string>
  metadata(): Promise<unknown>
  shutdown(): Promise<void>
}

export type LoadCuaDriver = () => Promise<CuaDriverSurface>

export const defaultLoadCuaDriver: LoadCuaDriver = async () => {
  try {
    const mod = (await import('@trycua/cua-driver')) as {
      CuaDriver: { create(options: undefined): CuaDriverSurface }
    }
    return mod.CuaDriver.create(undefined)
  } catch {
    throw new CliError(
      'ENOTSUPPORTED',
      'Cua Driver SDK is unavailable — install @trycua/cua-driver (npm, with the platform native package) or fall back to the core/mado commands',
    )
  }
}

interface ToolResultShape {
  text?: unknown
  structuredJson?: unknown
  isError?: unknown
  errorCode?: unknown
}

/** Shared passthrough: one SDK tool call with a mandatory session label. */
export async function callCuaTool(
  driver: CuaDriverSurface, action: string, argsJson: string | undefined, defaultSession: string,
): Promise<CommandPayload> {
  let args: Record<string, unknown>
  if (argsJson === undefined) {
    args = {}
  } else {
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>
    } catch {
      throw new CliError('EUSAGE', '--args must be a JSON object')
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw new CliError('EUSAGE', '--args must be a JSON object')
    }
  }
  // Window capture publication and element_token snapshots bind to the session
  // label; without one, capture paths fail with "capture binding is invalid".
  if (typeof args.session !== 'string' || args.session.trim() === '') {
    args.session = defaultSession
  }
  const raw = (await driver.callTool(action, JSON.stringify(args))) as ToolResultShape
  let structured: unknown
  if (typeof raw.structuredJson === 'string' && raw.structuredJson !== '') {
    try {
      structured = JSON.parse(raw.structuredJson)
    } catch {
      structured = raw.structuredJson
    }
  }
  const ok = raw.isError !== true
  const payload: CommandPayload = {
    ok,
    action,
    ...(ok ? {} : { errorCode: typeof raw.errorCode === 'string' && raw.errorCode !== '' ? raw.errorCode : 'EINPUT' }),
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
    ...(structured === undefined ? {} : { structured }),
  }
  return payload
}

export async function runCuaHealth(driver: CuaDriverSurface): Promise<CommandPayload> {
  const meta = (await driver.metadata()) as Record<string, unknown>
  let toolCount: number | undefined
  try {
    const tools = JSON.parse(await driver.listToolsJson()) as { tools?: unknown[] }
    if (Array.isArray(tools.tools)) toolCount = tools.tools.length
  } catch {
    toolCount = undefined
  }
  return {
    ok: true,
    action: 'health',
    driverVersion: typeof meta.driverVersion === 'string' ? meta.driverVersion : null,
    contractVersion: typeof meta.contractVersion === 'string' ? meta.contractVersion : null,
    ...(toolCount === undefined ? {} : { toolCount }),
    native: true,
  }
}

export async function runCua(
  invocation: CuaInvocation,
  _deps: CommandDeps,
  loadDriver: LoadCuaDriver = defaultLoadCuaDriver,
): Promise<CommandPayload> {
  const driver = await loadDriver()
  try {
    if (invocation.action === 'health') {
      return await runCuaHealth(driver)
    }
    if (invocation.action === 'list-tools') {
      let tools: unknown
      try {
        tools = JSON.parse(await driver.listToolsJson())
      } catch {
        throw new CliError('EBACKEND', 'Cua Driver returned an invalid tools list')
      }
      return { ok: true, action: 'list-tools', tools }
    }
    return await callCuaTool(driver, invocation.action, invocation.args, invocation.session)
  } finally {
    try {
      await driver.shutdown()
    } catch {
      /* shutdown is best-effort; the process is exiting anyway */
    }
  }
}
