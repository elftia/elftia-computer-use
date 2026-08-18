import { selectPlatform, type PlatformBackend } from '../platform/index.js'

export type CommandPayload = Record<string, unknown>

export interface CommandDeps {
  backend: PlatformBackend
  cwd: string
  now: () => Date
}

export function createDefaultDeps(): CommandDeps {
  return {
    backend: selectPlatform(),
    cwd: process.cwd(),
    now: () => new Date(),
  }
}
