import type { Invocation } from '../args.js'
import type { CommandDeps, CommandPayload } from './deps.js'
import { maybeAfterShot } from './shot.js'

type TypeInvocation = Extract<Invocation, { command: 'type' }>

/**
 * UTF-8 text input via clipboard-paste (design D6): Set-Clipboard + Ctrl+V.
 * Documented side effect: the user's clipboard content is REPLACED.
 */
export async function runType(inv: TypeInvocation, deps: CommandDeps): Promise<CommandPayload> {
  await deps.backend.clipboardType(inv.text)
  const after = await maybeAfterShot(deps, inv)
  const payload: CommandPayload = {
    ok: true,
    action: 'type',
    characters: Array.from(inv.text).length,
  }
  if (after !== undefined) {
    payload.after = after
  }
  return payload
}
