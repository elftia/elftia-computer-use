import type { Invocation } from '../args.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { maybeAfterShot } from './shot.js'

type KeyInvocation = Extract<Invocation, { command: 'key' }>

export async function runKey(inv: KeyInvocation, deps: CommandDeps): Promise<CommandPayload> {
  await deps.backend.sendInput({
    kind: 'key',
    vk: inv.vk,
    extended: inv.extended,
    mods: inv.mods,
    ...(inv.holdMs === undefined ? {} : { holdMs: inv.holdMs }),
  })
  const after = await maybeAfterShot(deps, inv)
  const payload: CommandPayload = {
    ok: true,
    action: 'key',
    combo: inv.combo,
    ...(inv.holdMs === undefined ? {} : { holdMs: inv.holdMs }),
  }
  if (after !== undefined) {
    payload.after = after
  }
  return payload
}
