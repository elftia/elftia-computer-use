import type { Invocation } from '../args.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { maybeAfterShot } from './shot.js'

type ScrollInvocation = Extract<Invocation, { command: 'scroll' }>

export async function runScroll(inv: ScrollInvocation, deps: CommandDeps): Promise<CommandPayload> {
  await deps.backend.sendInput({
    kind: 'scroll',
    x: inv.x,
    y: inv.y,
    direction: inv.direction,
    amount: inv.amount,
  })
  const after = await maybeAfterShot(deps, inv)
  const payload: CommandPayload = {
    ok: true,
    action: 'scroll',
    x: inv.x,
    y: inv.y,
    direction: inv.direction,
    amount: inv.amount,
  }
  if (after !== undefined) {
    payload.after = after
  }
  return payload
}
