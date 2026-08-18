import { describe, expect, it } from 'vitest'
import { CliError } from '../../errors.js'
import { FakeShellRunner } from '../../testing/fake-runner.js'
import { WindowsBackend } from './backend.js'

function backendWith(): { backend: WindowsBackend; runner: FakeShellRunner } {
  const runner = new FakeShellRunner()
  return { backend: new WindowsBackend(runner), runner }
}

function argsOf(runner: FakeShellRunner, scriptName: string): string[] {
  const call = runner.calls.find((c) => c.scriptName === scriptName)
  expect(call, `expected a ${scriptName} call`).toBeDefined()
  return call?.args ?? []
}

describe('WindowsBackend over a fake runner', () => {
  it('listApps maps the apps.ps1 payload', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('apps.ps1', () => ({
      ok: true,
      apps: [
        {
          id: 1001,
          pid: 4242,
          title: 'Notes — 记事本',
          appName: 'notepad',
          bounds: { x: 100, y: 100, width: 800, height: 600 },
        },
      ],
    }))
    const apps = await backend.listApps()
    expect(apps).toEqual([
      {
        id: 1001,
        pid: 4242,
        title: 'Notes — 记事本',
        appName: 'notepad',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
      },
    ])
    expect(argsOf(runner, 'apps.ps1')).toEqual([])
  })

  it('getState maps the cursor-state.ps1 payload', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('cursor-state.ps1', () => ({
      ok: true,
      cursor: { x: 512, y: 384 },
      screen: { width: 2560, height: 1440 },
      activeWindow: {
        id: 1001,
        pid: 4242,
        title: 'T',
        appName: 'a',
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
      },
    }))
    const raw = await backend.getState()
    expect(raw.cursor).toEqual({ x: 512, y: 384 })
    expect(raw.screen).toEqual({ width: 2560, height: 1440 })
    expect(raw.activeWindow.bounds.width).toBe(1280)
  })

  it('captureScreen forwards out path and max-edge to screenshot.ps1', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('screenshot.ps1', (call) => ({
      ok: true,
      path: call.args[1],
      width: 1280,
      height: 720,
    }))
    const img = await backend.captureScreen({ outPath: 'C:\\out\\s.png', maxEdge: 1280 })
    expect(img).toEqual({ path: 'C:\\out\\s.png', width: 1280, height: 720 })
    expect(argsOf(runner, 'screenshot.ps1')).toEqual([
      '-OutPath', 'C:\\out\\s.png', '-MaxEdge', '1280',
    ])
  })

  it('captureWindow adds -WindowId and tags the result', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('screenshot.ps1', () => ({ ok: true, path: 'p', width: 1, height: 2 }))
    const img = await backend.captureWindow(0x0a0b1c, { outPath: 'p' })
    expect(img.window).toBe(0x0a0b1c)
    expect(argsOf(runner, 'screenshot.ps1')).toEqual(['-OutPath', 'p', '-WindowId', '658204'])
  })

  it('sendInput click builds the input.ps1 argument vector', async () => {
    const { backend, runner } = backendWith()
    await backend.sendInput({
      kind: 'click',
      x: 500,
      y: 300,
      button: 'left',
      count: 2,
      mods: ['ctrl', 'shift'],
    })
    expect(argsOf(runner, 'input.ps1')).toEqual([
      '-Op', 'click', '-X', '500', '-Y', '300', '-Button', 'left', '-Count', '2',
      '-Mods', 'ctrl,shift',
    ])
  })

  it('sendInput key omits -Mods when empty', async () => {
    const { backend, runner } = backendWith()
    await backend.sendInput({ kind: 'key', vk: 0x53, extended: false, mods: [] })
    expect(argsOf(runner, 'input.ps1')).toEqual([
      '-Op', 'key', '-Vk', '83', '-Extended', '0',
    ])
  })

  it('sendInput scroll/drag/move build their vectors', async () => {
    const { backend, runner } = backendWith()
    await backend.sendInput({ kind: 'scroll', x: 640, y: 400, direction: 'down', amount: 3 })
    await backend.sendInput({ kind: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 })
    await backend.sendInput({ kind: 'move', x: -10, y: -5 })
    const inputCalls = runner.calls.filter((c) => c.scriptName === 'input.ps1')
    expect(inputCalls[0]?.args).toEqual([
      '-Op', 'scroll', '-X', '640', '-Y', '400', '-Direction', 'down', '-Amount', '3',
    ])
    expect(inputCalls[1]?.args).toEqual([
      '-Op', 'drag', '-FromX', '1', '-FromY', '2', '-ToX', '3', '-ToY', '4',
    ])
    expect(inputCalls[2]?.args).toEqual(['-Op', 'move', '-X', '-10', '-Y', '-5'])
  })

  it('uiaTree tree mode passes depth/nodes/out-path', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('uia-tree.ps1', () => ({
      ok: true,
      file: 'C:\\out\\tree.json',
      count: 512,
      truncated: true,
    }))
    const result = await backend.uiaTree({
      mode: 'tree',
      maxDepth: 6,
      maxNodes: 4000,
      outPath: 'C:\\out\\tree.json',
    })
    expect(result).toEqual({ kind: 'tree', file: 'C:\\out\\tree.json', count: 512, truncated: true })
    expect(argsOf(runner, 'uia-tree.ps1')).toEqual([
      '-Mode', 'tree', '-MaxDepth', '6', '-MaxNodes', '4000', '-OutPath', 'C:\\out\\tree.json',
    ])
  })

  it('uiaTree elements mode parses the element summaries', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('uia-tree.ps1', () => ({
      ok: true,
      elements: [
        {
          index: 0,
          role: 'button',
          name: 'OK',
          controlType: 'Button',
          bounds: { x: 10, y: 20, width: 80, height: 24 },
          center: { x: 50, y: 32 },
        },
      ],
      truncated: false,
    }))
    const result = await backend.uiaTree({ mode: 'elements', windowId: 1001 })
    expect(result.kind).toBe('elements')
    if (result.kind === 'elements') {
      expect(result.elements[0]).toEqual({
        index: 0,
        role: 'button',
        name: 'OK',
        controlType: 'Button',
        bounds: { x: 10, y: 20, width: 80, height: 24 },
        center: { x: 50, y: 32 },
      })
      expect(result.truncated).toBe(false)
    }
    expect(argsOf(runner, 'uia-tree.ps1')).toContain('-WindowId')
    expect(argsOf(runner, 'uia-tree.ps1')).toContain('1001')
  })

  it('propagates script-emitted EINPUT errors unchanged', async () => {
    const { backend, runner } = backendWith()
    runner.failures.set(
      'input.ps1',
      () => new CliError('EINPUT', 'backend script "input.ps1": SendInput injected 0 of 2 events'),
    )
    await expect(
      backend.sendInput({ kind: 'click', x: 1, y: 2, button: 'left', count: 1, mods: [] }),
    ).rejects.toMatchObject({ code: 'EINPUT' })
  })

  it('maps unparseable runner output to EBACKEND', async () => {
    const { backend, runner } = backendWith()
    runner.failures.set('apps.ps1', () => new CliError('EBACKEND', 'backend script "apps.ps1" produced unparseable output: oops'))
    await expect(backend.listApps()).rejects.toMatchObject({ code: 'EBACKEND' })
  })

  it('probe returns version/latency/elevation and runs the echo fixture', async () => {
    const { backend, runner } = backendWith()
    runner.responses.set('echo.ps1', () => ({ ok: true, echo: '你好 🌏' }))
    const probe = await backend.probe({ echo: '你好 🌏' })
    expect(probe.version).toBe('5.1.26100.8875')
    expect(probe.elevated).toBe(false)
    expect(typeof probe.latencyMs).toBe('number')
    expect(probe.echo).toBe('你好 🌏')
    expect(argsOf(runner, 'echo.ps1')).toEqual(['-Text', '你好 🌏'])
  })

  it('probe without echo never spawns echo.ps1', async () => {
    const { backend, runner } = backendWith()
    await backend.probe()
    expect(runner.calls.find((c) => c.scriptName === 'echo.ps1')).toBeUndefined()
  })
})
