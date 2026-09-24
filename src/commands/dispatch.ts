import type { Invocation } from '../args.js'
import { runApps } from './apps.js'
import { runClick } from './click.js'
import { runCrop } from './crop.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { runDoctor } from './doctor.js'
import { runDrag } from './drag.js'
import { runGetState } from './get-state.js'
import { runKey } from './key.js'
import { runMado } from './mado.js'
import { runScreenshot } from './screenshot.js'
import { runScroll } from './scroll.js'
import { runType } from './type.js'
import { runUiaTree } from './uia-tree.js'

export async function dispatch(
  invocation: Invocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  switch (invocation.command) {
    case 'apps':
      return runApps(deps)
    case 'get-state':
      return runGetState(invocation, deps)
    case 'crop':
      return runCrop(invocation, deps)

    case 'screenshot':
      return runScreenshot(invocation, deps)
    case 'click':
      return runClick(invocation, deps)
    case 'type':
      return runType(invocation, deps)
    case 'key':
      return runKey(invocation, deps)
    case 'scroll':
      return runScroll(invocation, deps)
    case 'drag':
      return runDrag(invocation, deps)
    case 'uia-tree':
      return runUiaTree(invocation, deps)
    case 'doctor':
      return runDoctor(invocation, deps)
    case 'mado':
      return runMado(invocation, deps)
  }
}
