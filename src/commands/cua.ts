import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { CuaInvocation } from '../args.js'
import { CliError } from '../errors.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { cuaArgsWantForeground, withForegroundNotice } from './foreground-notice.js'

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

function importFromNodeModules(nodeModulesDir: string): Promise<{
  CuaDriver: { create(options: undefined): CuaDriverSurface }
}> {
  // The SDK is ESM-only with a restrictive exports map, so resolve its entry
  // by reading package.json instead of require.resolve (CJS resolution).
  const pkgJson = join(nodeModulesDir, '@trycua', 'cua-driver', 'package.json')
  if (!existsSync(pkgJson)) throw new Error('no package.json')
  const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { main?: string }
  const entry = pkg.main ?? './dist/index.js'
  const entryPath = join(nodeModulesDir, '@trycua', 'cua-driver', entry)
  if (!existsSync(entryPath)) throw new Error('entry missing')
  return import(pathToFileURL(entryPath).href) as Promise<{
    CuaDriver: { create(options: undefined): CuaDriverSurface }
  }>
}

/**
 * Candidate `node_modules` roots for the SDK, in order:
 *  1. `ELFTIA_CUA_DRIVER_NODE_MODULES` (absolute override);
 *  2. `prebuilds/<platform>-<arch>/node_modules` in any ancestor directory of
 *     this file — the plugin packaging channel ships the SDK there, and the
 *     vendored CLI sits inside the same plugin tree (skills/…/scripts).
 * Bare `import('@trycua/cua-driver')` is tried first for repo/dev shapes
 * where node_modules sits beside the CLI scripts.
 */
export function candidateSdkNodeModules(): string[] {
  const platformDir = `prebuilds/${process.platform}-${process.arch}`
  const roots: string[] = []
  const override = process.env.ELFTIA_CUA_DRIVER_NODE_MODULES
  if (override) roots.push(override)
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 12; depth += 1) {
    roots.push(join(dir, platformDir, 'node_modules'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

export const defaultLoadCuaDriver: LoadCuaDriver = async () => {
  const unavailable = new CliError(
    'ENOTSUPPORTED',
    'Cua Driver SDK is unavailable — install @trycua/cua-driver (npm, the plugin prebuilds channel, or ELFTIA_CUA_DRIVER_NODE_MODULES) or fall back to the core/mado commands',
  )
  try {
    const mod = (await import('@trycua/cua-driver')) as {
      CuaDriver: { create(options: undefined): CuaDriverSurface }
    }
    return mod.CuaDriver.create(undefined)
  } catch {
    /* fall through to the explicit-root candidates below */
  }
  for (const root of candidateSdkNodeModules()) {
    try {
      const mod = await importFromNodeModules(root)
      return mod.CuaDriver.create(undefined)
    } catch {
      /* try the next candidate root */
    }
  }
  throw unavailable
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
  const call = () =>
    (driver.callTool(action, JSON.stringify(args)) as Promise<ToolResultShape>)
  // Foreground delivery takes over the user's real mouse/keyboard — wrap it
  // in the visibility notice (busy cursor + throttled tray toast).
  const raw = cuaArgsWantForeground(args)
    ? await withForegroundNotice(call)
    : await call()
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
