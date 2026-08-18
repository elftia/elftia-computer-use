import type { Invocation } from '../args.js'
import { CliError } from '../errors.js'
import {
  findElement,
  findLiveWindow,
  isMinimizedRect,
  readState,
  rescalePoint,
  staleStateMessage,
} from '../state.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { maybeAfterShot } from './shot.js'

type ClickInvocation = Extract<Invocation, { command: 'click' }>

export async function runClick(
  inv: ClickInvocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  let x: number
  let y: number
  let rescaledFrom: { x: number; y: number } | undefined
  let element: number | undefined

  if (inv.mode === 'coords') {
    x = inv.x as number
    y = inv.y as number
  } else {
    const state = readState(inv.stateFile as string)
    element = inv.element as number
    const el = findElement(state, element)
    if (el === undefined) {
      throw new CliError(
        'EUSAGE',
        `state file has no element with index ${element} (it has ${state.elements.length} elements)`,
      )
    }
    const apps = await deps.backend.listApps()
    const live = findLiveWindow(apps, state.activeWindow)
    if (live === null) {
      throw new CliError('ESTALE', staleStateMessage(state.activeWindow))
    }
    if (isMinimizedRect(live.bounds) || live.bounds.width <= 0 || live.bounds.height <= 0) {
      throw new CliError(
        'ESTALE',
        `the state file's window (pid ${state.activeWindow.pid}, title "${state.activeWindow.title}") ` +
          'is minimized or has no live bounds — run "computer-use get-state" again',
      )
    }
    rescaledFrom = el.center
    const target = rescalePoint(state.activeWindow.bounds, live.bounds, el.center)
    x = target.x
    y = target.y
  }

  await deps.backend.sendInput({
    kind: 'click',
    x,
    y,
    button: inv.button,
    count: inv.clickCount,
    mods: inv.mods,
  })
  const after = await maybeAfterShot(deps, inv)

  const payload: CommandPayload = {
    ok: true,
    action: 'click',
    mode: inv.mode,
    x,
    y,
    button: inv.button,
    clickCount: inv.clickCount,
    mods: inv.mods,
  }
  if (element !== undefined) {
    payload.element = element
  }
  if (rescaledFrom !== undefined) {
    payload.rescaledFrom = rescaledFrom
  }
  if (after !== undefined) {
    payload.after = after
  }
  return payload
}
