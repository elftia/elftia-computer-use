import { describe, expect, it } from 'vitest'
import { parseArgv } from '../args.js'
import { CliError } from '../errors.js'
import { StubBackend } from './stub.js'

async function expectNotSupported(promise: Promise<unknown>, os: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(CliError)
  const err = caught as CliError
  expect(err.code).toBe('ENOTSUPPORTED')
  expect(err.message).toContain(`not yet supported on ${os}`)
}

describe('stub backend (macOS/Linux honest failure)', () => {
  it('every op rejects with ENOTSUPPORTED naming the OS', async () => {
    const stub = new StubBackend('macos')
    await expectNotSupported(stub.listApps(), 'macos')
    await expectNotSupported(stub.getState(), 'macos')
    await expectNotSupported(stub.captureScreen({ outPath: 'x.png' }), 'macos')
    await expectNotSupported(stub.captureWindow(1, { outPath: 'x.png' }), 'macos')
    await expectNotSupported(stub.sendInput({ kind: 'move', x: 1, y: 1 }), 'macos')
    await expectNotSupported(stub.uiaTree({ mode: 'tree' }), 'macos')
    await expectNotSupported(stub.clipboardType('x'), 'macos')
    await expectNotSupported(stub.probe(), 'macos')
  })

  it('names linux on the linux stub', async () => {
    const stub = new StubBackend('linux')
    await expectNotSupported(stub.captureScreen({ outPath: 'x.png' }), 'linux')
  })

  it('help and version parse before any platform dispatch (work everywhere)', () => {
    expect(parseArgv(['--help']).kind).toBe('help')
    expect(parseArgv(['--version']).kind).toBe('version')
    expect(parseArgv(['screenshot', '--help']).kind).toBe('help')
  })
})
