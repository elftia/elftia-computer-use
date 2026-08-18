import { join } from 'node:path'
import type { Invocation } from '../args.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import type { CommandDeps, CommandPayload } from './deps.js'

type ScreenshotInvocation = Extract<Invocation, { command: 'screenshot' }>

/**
 * Screenshot payload contract: `width`/`height` are the ACTUAL pixel dims of
 * the written PNG (after --window crop and --max-edge downsampling), never the
 * native screen dims.
 */
export async function runScreenshot(
  inv: ScreenshotInvocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  const dir = ensureDir(resolveOutDir(deps, inv.out))
  const outPath = join(dir, 'screen.png')
  const captureOpts = { outPath, maxEdge: inv.maxEdge, region: inv.region }
  const img =
    inv.window !== undefined
      ? await deps.backend.captureWindow(inv.window, captureOpts)
      : await deps.backend.captureScreen(captureOpts)
  const payload: CommandPayload = {
    ok: true,
    path: img.path,
    width: img.width,
    height: img.height,
  }
  if (inv.window !== undefined) {
    payload.window = inv.window
  }
  return payload
}
