import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { CliError, errorMessage } from './errors.js'

export interface OutDirDeps {
  cwd: string
  now: () => Date
}

/** Windows-filesystem-safe timestamped segment: 20260818-215959-123 */
export function timestampDirName(date: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}` +
    `-${p(date.getMilliseconds(), 3)}`
  )
}

/**
 * Resolve `--out`. Default payload directory is
 * `<cwd>/.computer-use/<timestamp>/` (frozen payload discipline).
 */
export function resolveOutDir(deps: OutDirDeps, explicit?: string): string {
  if (explicit !== undefined && explicit !== '') {
    return isAbsolute(explicit) ? explicit : resolve(deps.cwd, explicit)
  }
  return join(deps.cwd, '.computer-use', timestampDirName(deps.now()))
}

/** Create the directory (recursive), mapping failures to EIO. */
export function ensureDir(path: string): string {
  try {
    mkdirSync(path, { recursive: true })
  } catch (err) {
    throw new CliError('EIO', `cannot create output directory ${path}: ${errorMessage(err)}`)
  }
  return path
}
