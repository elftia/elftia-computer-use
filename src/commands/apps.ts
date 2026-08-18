import type { CommandDeps, CommandPayload } from './deps.js'

export async function runApps(deps: CommandDeps): Promise<CommandPayload> {
  const apps = await deps.backend.listApps()
  return { ok: true, apps }
}
