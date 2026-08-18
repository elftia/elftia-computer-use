import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgv, type Invocation } from '../args.js'
import { CliError } from '../errors.js'
import { FakeBackend } from '../testing/fake-backend.js'
import { runApps } from './apps.js'
import type { CommandDeps } from './deps.js'
import { runGetState } from './get-state.js'
import { runScreenshot } from './screenshot.js'
import { runUiaTree } from './uia-tree.js'

let cwd: string
let backend: FakeBackend

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cucu-perc-'))
  backend = new FakeBackend()
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function deps(): CommandDeps {
  return { backend, cwd, now: () => new Date(2026, 7, 18, 12, 0, 0, 0) }
}

function invOf(argv: string[]): Invocation {
  const parsed = parseArgv(argv)
  if (parsed.kind !== 'command') {
    throw new Error(`expected a command for: ${argv.join(' ')}`)
  }
  return parsed.invocation
}

describe('apps', () => {
  it('returns the window array inside the success envelope', async () => {
    const payload = await runApps(deps())
    expect(payload.ok).toBe(true)
    const apps = payload.apps as Array<{ id: number; pid: number; title: string; appName: string }>
    expect(apps).toHaveLength(2)
    expect(apps[0]).toMatchObject({ id: 1001, pid: 4242, appName: 'notepad' })
    expect(apps[1]).toMatchObject({ id: 2002, pid: 5151 })
  })
})

describe('screenshot', () => {
  it('writes screen.png into the default timestamped out dir and reports honest dims', async () => {
    const payload = await runScreenshot(invOf(['screenshot']) as Extract<Invocation, { command: 'screenshot' }>, deps())
    const expectedDir = join(cwd, '.computer-use', '20260818-120000-000')
    expect(payload).toMatchObject({
      ok: true,
      path: join(expectedDir, 'screen.png'),
      width: 1920,
      height: 1080,
    })
    expect('window' in payload).toBe(false)
    expect(existsSync(join(expectedDir, 'screen.png'))).toBe(true)
  })

  it('honors --out and --window and tags the window field', async () => {
    const payload = await runScreenshot(
      invOf(['screenshot', '--window', '1001', '--out', 'shots', '--max-edge', '1280']) as Extract<
        Invocation,
        { command: 'screenshot' }
      >,
      deps(),
    )
    expect(payload).toMatchObject({ ok: true, window: 1001 })
    expect(String(payload.path)).toBe(join(cwd, 'shots', 'screen.png'))
    expect(backend.captureCalls[0]).toMatchObject({ maxEdge: 1280, window: 1001 })
  })

  it('stdout payload carries paths and metadata only — never image data', async () => {
    const payload = await runScreenshot(invOf(['screenshot']) as Extract<Invocation, { command: 'screenshot' }>, deps())
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('base64')
    expect(serialized.length).toBeLessThan(500)
  })
})

describe('get-state', () => {
  it('writes state.json + screen.png and prints state path + metadata', async () => {
    const payload = await runGetState(invOf(['get-state']) as Extract<Invocation, { command: 'get-state' }>, deps())
    const expectedDir = join(cwd, '.computer-use', '20260818-120000-000')
    const statePath = join(expectedDir, 'state.json')

    expect(payload.ok).toBe(true)
    expect(payload.state).toBe(statePath)
    expect(existsSync(statePath)).toBe(true)
    expect(existsSync(join(expectedDir, 'screen.png'))).toBe(true)

    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    expect(state.schema).toBe(1)
    expect(state.screen).toEqual({ width: 1920, height: 1080 })
    expect(state.cursor).toEqual({ x: 512, y: 384 })
    expect((state.activeWindow as { id: number }).id).toBe(1001)
    expect(Array.isArray(state.elements)).toBe(true)
    expect(state.elementsTruncated).toBe(false)

    expect(payload).toMatchObject({ elementsCount: 2, elementsTruncated: false })
  })

  it('bounds the element summary to the 200-element cap (cap forwarded to the walk)', async () => {
    await runGetState(invOf(['get-state']) as Extract<Invocation, { command: 'get-state' }>, deps())
    expect(backend.uiaTreeCalls[0]).toMatchObject({ mode: 'elements', maxElements: 200 })
  })

  it('surfaces elementsTruncated when the walk was capped', async () => {
    backend = new FakeBackend({ elementsTruncated: true })
    const payload = await runGetState(invOf(['get-state']) as Extract<Invocation, { command: 'get-state' }>, deps())
    expect(payload.elementsTruncated).toBe(true)
  })

  it('--app <pid> targets that process window', async () => {
    const payload = await runGetState(
      invOf(['get-state', '--app', '5151']) as Extract<Invocation, { command: 'get-state' }>,
      deps(),
    )
    expect((payload.activeWindow as { id: number }).id).toBe(2002)
  })

  it('--app with no window fails EUSAGE', async () => {
    let caught: unknown
    try {
      await runGetState(invOf(['get-state', '--app', '9999']) as Extract<Invocation, { command: 'get-state' }>, deps())
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CliError)
    expect((caught as CliError).code).toBe('EUSAGE')
    expect((caught as CliError).message).toContain('9999')
  })
})

describe('uia-tree', () => {
  it('writes the tree to the default out file and prints path + count only', async () => {
    const payload = await runUiaTree(invOf(['uia-tree']) as Extract<Invocation, { command: 'uia-tree' }>, deps())
    expect(payload).toMatchObject({
      ok: true,
      file: join(cwd, '.computer-use', '20260818-120000-000', 'uia-tree.json'),
      count: 2,
      truncated: false,
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('children')
    expect(serialized.length).toBeLessThan(500)
  })

  it('honors a custom --out file resolved against cwd', async () => {
    const payload = await runUiaTree(
      invOf(['uia-tree', '--out', 'trees/deep.json', '--max-depth', '6']) as Extract<
        Invocation,
        { command: 'uia-tree' }
      >,
      deps(),
    )
    expect(payload.file).toBe(join(cwd, 'trees', 'deep.json'))
    expect(existsSync(join(cwd, 'trees', 'deep.json'))).toBe(true)
    expect(backend.uiaTreeCalls[0]).toMatchObject({ maxDepth: 6, mode: 'tree' })
  })
})
