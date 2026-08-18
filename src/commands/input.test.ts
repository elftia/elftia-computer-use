import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgv, type Invocation } from '../args.js'
import { CliError } from '../errors.js'
import type { AppWindow } from '../platform/types.js'
import type { StateFileV1 } from '../state.js'
import { FakeBackend, FAKE_WINDOWS } from '../testing/fake-backend.js'
import { runClick } from './click.js'
import type { CommandDeps } from './deps.js'
import { runDrag } from './drag.js'
import { runKey } from './key.js'
import { runScroll } from './scroll.js'
import { runType } from './type.js'

let cwd: string
let backend: FakeBackend

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cucu-input-'))
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

function writeStateFile(state: StateFileV1): string {
  const path = join(cwd, 'state.json')
  writeFileSync(path, JSON.stringify(state))
  return path
}

function stateFixture(window: AppWindow, elementCenter: { x: number; y: number }): StateFileV1 {
  return {
    schema: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    screen: { width: 1920, height: 1080 },
    cursor: { x: 1, y: 1 },
    activeWindow: window,
    screenshot: { path: 'unused', width: 1, height: 1 },
    elements: [
      {
        index: 3,
        role: 'button',
        name: 'OK',
        controlType: 'Button',
        bounds: { x: elementCenter.x - 40, y: elementCenter.y - 12, width: 80, height: 24 },
        center: elementCenter,
      },
    ],
    elementsTruncated: false,
  }
}

describe('click: coordinate mode', () => {
  it('injects a plain left click', async () => {
    const payload = await runClick(invOf(['click', '--x', '500', '--y', '300']) as Extract<Invocation, { command: 'click' }>, deps())
    expect(backend.inputEvents).toEqual([
      { kind: 'click', x: 500, y: 300, button: 'left', count: 1, mods: [] },
    ])
    expect(payload).toMatchObject({ ok: true, action: 'click', mode: 'coords', x: 500, y: 300 })
  })

  it('injects a modified double click', async () => {
    await runClick(
      invOf(['click', '--x', '10', '--y', '20', '--double', '--mods', 'ctrl+shift']) as Extract<
        Invocation,
        { command: 'click' }
      >,
      deps(),
    )
    expect(backend.inputEvents[0]).toMatchObject({
      kind: 'click',
      x: 10,
      y: 20,
      count: 2,
      mods: ['ctrl', 'shift'],
    })
  })

  it('injects a triple right click', async () => {
    await runClick(
      invOf(['click', '--x', '1', '--y', '2', '--button', 'right', '--triple']) as Extract<
        Invocation,
        { command: 'click' }
      >,
      deps(),
    )
    expect(backend.inputEvents[0]).toMatchObject({ button: 'right', count: 3 })
  })
})

describe('click: state-file element addressing', () => {
  it('rescales the element center against live bounds after a move', async () => {
    const captured = FAKE_WINDOWS[0] // {100,100,800,600}
    const statePath = writeStateFile(stateFixture({ ...captured }, { x: 500, y: 388 }))
    backend = new FakeBackend({
      apps: [{ ...captured, bounds: { x: 300, y: 200, width: 800, height: 600 } }],
    })
    const payload = await runClick(
      invOf(['click', '--state', statePath, '--element', '3']) as Extract<Invocation, { command: 'click' }>,
      deps(),
    )
    // x = 300 + (500-100)*1, y = 200 + (388-100)*1
    expect(backend.inputEvents[0]).toMatchObject({ kind: 'click', x: 700, y: 488 })
    expect(payload).toMatchObject({ mode: 'element', element: 3, rescaledFrom: { x: 500, y: 388 } })
  })

  it('rescales after a resize', async () => {
    const captured = FAKE_WINDOWS[0]
    const statePath = writeStateFile(stateFixture({ ...captured }, { x: 600, y: 300 }))
    backend = new FakeBackend({
      apps: [{ ...captured, bounds: { x: 0, y: 0, width: 400, height: 300 } }],
    })
    await runClick(
      invOf(['click', '--state', statePath, '--element', '3']) as Extract<Invocation, { command: 'click' }>,
      deps(),
    )
    // x = 0 + (600-100)*0.5, y = 0 + (300-100)*0.5
    expect(backend.inputEvents[0]).toMatchObject({ x: 250, y: 100 })
  })

  it('fails ESTALE (no click injected) when the window is unmatchable', async () => {
    const captured = FAKE_WINDOWS[0]
    const statePath = writeStateFile(stateFixture({ ...captured }, { x: 500, y: 388 }))
    backend = new FakeBackend({
      apps: [{ ...FAKE_WINDOWS[1] }],
    })
    let caught: unknown
    try {
      await runClick(
        invOf(['click', '--state', statePath, '--element', '3']) as Extract<Invocation, { command: 'click' }>,
        deps(),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CliError)
    expect((caught as CliError).code).toBe('ESTALE')
    expect((caught as CliError).message).toContain('get-state')
    expect(backend.inputEvents).toHaveLength(0)
  })

  it('fails ESTALE when the live window is minimized', async () => {
    const captured = FAKE_WINDOWS[0]
    const statePath = writeStateFile(stateFixture({ ...captured }, { x: 500, y: 388 }))
    backend = new FakeBackend({
      apps: [{ ...captured, bounds: { x: -32000, y: -32000, width: 160, height: 28 } }],
    })
    await expect(
      runClick(invOf(['click', '--state', statePath, '--element', '3']) as Extract<Invocation, { command: 'click' }>, deps()),
    ).rejects.toMatchObject({ code: 'ESTALE' })
    expect(backend.inputEvents).toHaveLength(0)
  })

  it('fails EUSAGE for an unknown element index', async () => {
    const statePath = writeStateFile(stateFixture({ ...FAKE_WINDOWS[0] }, { x: 500, y: 388 }))
    await expect(
      runClick(invOf(['click', '--state', statePath, '--element', '99']) as Extract<Invocation, { command: 'click' }>, deps()),
    ).rejects.toMatchObject({ code: 'EUSAGE' })
  })
})

describe('type / key / scroll / drag', () => {
  it('type routes text to the clipboard-paste path and counts code points', async () => {
    const payload = await runType(invOf(['type', '--text', '你好 🌏 naïve']) as Extract<Invocation, { command: 'type' }>, deps())
    expect(backend.clipboardTexts).toEqual(['你好 🌏 naïve'])
    expect(payload.characters).toBe(10)
    expect(backend.inputEvents).toHaveLength(0)
  })

  it('key injects the resolved virtual key with modifiers', async () => {
    await runKey(invOf(['key', '--combo', 'ctrl+s']) as Extract<Invocation, { command: 'key' }>, deps())
    expect(backend.inputEvents[0]).toEqual({
      kind: 'key',
      vk: 0x53,
      extended: false,
      mods: ['ctrl'],
    })
  })

  it('scroll injects direction and amount at the coordinates', async () => {
    const payload = await runScroll(
      invOf(['scroll', '--x', '640', '--y', '400', '--direction', 'down', '--amount', '3']) as Extract<
        Invocation,
        { command: 'scroll' }
      >,
      deps(),
    )
    expect(backend.inputEvents[0]).toEqual({
      kind: 'scroll',
      x: 640,
      y: 400,
      direction: 'down',
      amount: 3,
    })
    expect(payload).toMatchObject({ action: 'scroll', direction: 'down' })
  })

  it('drag injects press-move-release between the two points', async () => {
    await runDrag(
      invOf(['drag', '--from-x', '100', '--from-y', '100', '--to-x', '400', '--to-y', '400']) as Extract<
        Invocation,
        { command: 'drag' }
      >,
      deps(),
    )
    expect(backend.inputEvents[0]).toEqual({
      kind: 'drag',
      fromX: 100,
      fromY: 100,
      toX: 400,
      toY: 400,
    })
  })
})

describe('--shot after-screenshot', () => {
  it('adds an after reference with the fresh screenshot dims', async () => {
    const payload = await runClick(
      invOf(['click', '--x', '100', '--y', '100', '--shot']) as Extract<Invocation, { command: 'click' }>,
      deps(),
    )
    expect(payload.after).toMatchObject({
      path: join(cwd, '.computer-use', '20260818-120000-000', 'after.png'),
      width: 1920,
      height: 1080,
    })
    expect(backend.captureCalls).toHaveLength(1)
    expect(existsSync(String((payload.after as { path: string }).path))).toBe(true)
  })

  it('is off by default (no extra capture)', async () => {
    const payload = await runClick(invOf(['click', '--x', '1', '--y', '1']) as Extract<Invocation, { command: 'click' }>, deps())
    expect('after' in payload).toBe(false)
    expect(backend.captureCalls).toHaveLength(0)
  })

  it('works on type too', async () => {
    const payload = await runType(invOf(['type', '--text', 'hi', '--shot']) as Extract<Invocation, { command: 'type' }>, deps())
    expect(payload.after).toMatchObject({ width: 1920, height: 1080 })
  })
})
