import { describe, expect, it } from 'vitest'
import { createShellRunner } from '../shell-runner.js'

/**
 * Design D3 pinned test: a fixture string with CJK + emoji + accents must
 * survive the real -File script channel byte-for-byte (arg encoding in,
 * UTF-8 console out, Node utf8 decode). Windows-only: spawns powershell.exe.
 */
describe.skipIf(process.platform !== 'win32')('real PowerShell script channel (UTF-8)', () => {
  it('round-trips CJK + emoji byte-for-byte through echo.ps1', async () => {
    const runner = createShellRunner()
    const fixture = '你好 🌏 naïve ✓ — æøå'
    const json = await runner.run('echo.ps1', ['-Text', fixture])
    expect(json.ok).toBe(true)
    expect(json.echo).toBe(fixture)
  })

  it('emits exactly one parseable JSON object on stdout', async () => {
    const runner = createShellRunner()
    const json = await runner.run('echo.ps1', ['-Text', 'x'])
    expect(json.ok).toBe(true)
    expect(json.echo).toBe('x')
  })
})
