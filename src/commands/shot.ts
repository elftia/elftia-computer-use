import { join } from 'node:path'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import type { CommandDeps } from './deps.js'

export interface ShotOptions {
  shot?: boolean
  out?: string
}

export interface AfterShot {
  path: string
  width: number
  height: number
}

/**
 * `--shot` on action commands: capture a fresh screenshot after the action and
 * include it as an `after` reference (frozen payload discipline).
 */
export async function maybeAfterShot(
  deps: CommandDeps,
  opts: ShotOptions,
): Promise<AfterShot | undefined> {
  if (opts.shot !== true) {
    return undefined
  }
  const dir = ensureDir(resolveOutDir(deps, opts.out))
  const img = await deps.backend.captureScreen({ outPath: join(dir, 'after.png') })
  return { path: img.path, width: img.width, height: img.height }
}
