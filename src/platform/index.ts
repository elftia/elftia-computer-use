import { StubBackend } from './stub.js'
import type { PlatformBackend } from './types.js'
import { WindowsBackend } from './windows/backend.js'

export * from './types.js'
export { StubBackend } from './stub.js'
export { WindowsBackend } from './windows/backend.js'
export { createShellRunner, scriptPath } from './shell-runner.js'

/** WindowsBackend on win32; an honest ENOTSUPPORTED stub everywhere else. */
export function selectPlatform(): PlatformBackend {
  if (process.platform === 'win32') {
    return new WindowsBackend()
  }
  return new StubBackend(process.platform === 'darwin' ? 'macos' : 'linux')
}
