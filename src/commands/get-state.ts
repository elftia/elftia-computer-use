import { join } from 'node:path'
import type { Invocation } from '../args.js'
import { CliError } from '../errors.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import { isMinimizedRect, writeState, type StateFileV1 } from '../state.js'
import type { CommandDeps, CommandPayload } from './deps.js'

type GetStateInvocation = Extract<Invocation, { command: 'get-state' }>

/** Frozen cap for the indexed element summary inside state.json (design D7). */
export const STATE_ELEMENTS_CAP = 200

export async function runGetState(
  inv: GetStateInvocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  const dir = ensureDir(resolveOutDir(deps, inv.out))
  const raw = await deps.backend.getState()

  let activeWindow = raw.activeWindow
  if (inv.app !== undefined) {
    const apps = await deps.backend.listApps()
    const found = apps.find((a) => a.pid === inv.app && !isMinimizedRect(a.bounds))
    if (found === undefined) {
      throw new CliError('EUSAGE', `no visible top-level window found for pid ${inv.app}`)
    }
    activeWindow = found
  }

  const shot = await deps.backend.captureScreen({ outPath: join(dir, 'screen.png') })
  const elementsResult = await deps.backend.uiaTree({
    mode: 'elements',
    windowId: activeWindow.id,
    maxElements: STATE_ELEMENTS_CAP,
  })
  if (elementsResult.kind !== 'elements') {
    throw new CliError('EBACKEND', 'elements walk returned an unexpected result shape')
  }

  const state: StateFileV1 = {
    schema: 1,
    createdAt: deps.now().toISOString(),
    screen: raw.screen,
    cursor: raw.cursor,
    activeWindow,
    screenshot: { path: shot.path, width: shot.width, height: shot.height },
    elements: elementsResult.elements,
    elementsTruncated: elementsResult.truncated,
  }
  const statePath = join(dir, 'state.json')
  writeState(statePath, state)

  return {
    ok: true,
    state: statePath,
    screen: raw.screen,
    cursor: raw.cursor,
    activeWindow,
    elementsCount: elementsResult.elements.length,
    elementsTruncated: elementsResult.truncated,
    screenshot: { path: shot.path, width: shot.width, height: shot.height },
  }
}
