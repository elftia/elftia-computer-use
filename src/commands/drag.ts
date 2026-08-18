import type { Invocation } from '../args.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { maybeAfterShot } from './shot.js'

type DragInvocation = Extract<Invocation, { command: 'drag' }>

export async function runDrag(inv: DragInvocation, deps: CommandDeps): Promise<CommandPayload> {
  await deps.backend.sendInput({
    kind: 'drag',
    fromX: inv.fromX,
    fromY: inv.fromY,
    toX: inv.toX,
    toY: inv.toY,
  })
  const after = await maybeAfterShot(deps, inv)
  const payload: CommandPayload = {
    ok: true,
    action: 'drag',
    from: { x: inv.fromX, y: inv.fromY },
    to: { x: inv.toX, y: inv.toY },
  }
  if (after !== undefined) {
    payload.after = after
  }
  return payload
}
