import { join } from 'node:path'
import type { Invocation } from '../args.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import type { CommandDeps, CommandPayload } from './deps.js'

type CropInvocation = Extract<Invocation, { command: 'crop' }>

/**
 * Crop payload contract: `width`/`height` are the cropped PNG's ACTUAL dims;
 * `source` reports the input image's dims and path; `region` echoes the
 * requested rect in the SOURCE image's pixel frame.
 */
export async function runCrop(
  inv: CropInvocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  const dir = ensureDir(resolveOutDir(deps, inv.out))
  const outPath = join(dir, 'crop.png')
  const result = await deps.backend.cropImage({
    sourcePath: inv.in,
    region: inv.region,
    outPath,
  })
  return {
    ok: true,
    action: 'crop',
    path: result.path,
    width: result.width,
    height: result.height,
    source: result.source,
    region: [inv.region.x1, inv.region.y1, inv.region.x2, inv.region.y2],
  }
}
