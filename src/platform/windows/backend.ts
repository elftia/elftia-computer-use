import { CliError } from '../../errors.js'
import { createShellRunner, type ShellRunner } from '../shell-runner.js'
import type {
  AppWindow,
  CapturedImage,
  CaptureOptions,
  CropOptions,
  CropResult,
  InputEvent,
  PlatformBackend,
  ProbeInfo,
  RawState,
  Rect,
  UiaElementSummary,
  UiaTreeOptions,
  UiaTreeResult,
} from '../types.js'

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new CliError('EBACKEND', `backend field ${where} is not an object`)
}

function toNum(value: unknown, where: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  throw new CliError('EBACKEND', `backend field ${where} is not a number`)
}

function toStr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseRect(value: unknown, where: string): Rect {
  const rec = asRecord(value, where)
  return {
    x: toNum(rec.x, `${where}.x`),
    y: toNum(rec.y, `${where}.y`),
    width: toNum(rec.width, `${where}.width`),
    height: toNum(rec.height, `${where}.height`),
  }
}

function parseAppWindow(value: unknown): AppWindow {
  const rec = asRecord(value, 'app window')
  return {
    id: toNum(rec.id, 'window.id'),
    pid: toNum(rec.pid, 'window.pid'),
    title: toStr(rec.title),
    appName: toStr(rec.appName),
    bounds: parseRect(rec.bounds, 'window.bounds'),
  }
}

function parseElement(value: unknown, i: number): UiaElementSummary {
  const rec = asRecord(value, `elements[${i}]`)
  const center = asRecord(rec.center, `elements[${i}].center`)
  return {
    index: toNum(rec.index, `elements[${i}].index`),
    role: toStr(rec.role),
    name: toStr(rec.name),
    controlType: toStr(rec.controlType),
    bounds: parseRect(rec.bounds, `elements[${i}].bounds`),
    center: {
      x: toNum(center.x, `elements[${i}].center.x`),
      y: toNum(center.y, `elements[${i}].center.y`),
    },
  }
}

/**
 * Windows implementation of the PlatformBackend seam: every op is one
 * PowerShell script invocation through the injectable ShellRunner (design D2).
 */
export class WindowsBackend implements PlatformBackend {
  readonly os = 'windows' as const
  private readonly runner: ShellRunner

  constructor(runner: ShellRunner = createShellRunner()) {
    this.runner = runner
  }

  async listApps(): Promise<AppWindow[]> {
    const json = await this.runner.run('apps.ps1', [])
    if (!Array.isArray(json.apps)) {
      throw new CliError('EBACKEND', 'apps.ps1 did not return a windows array')
    }
    return json.apps.map((w) => parseAppWindow(w))
  }

  async getState(): Promise<RawState> {
    const json = await this.runner.run('cursor-state.ps1', [])
    const cursor = asRecord(json.cursor, 'cursor')
    const screen = asRecord(json.screen, 'screen')
    return {
      cursor: { x: toNum(cursor.x, 'cursor.x'), y: toNum(cursor.y, 'cursor.y') },
      screen: { width: toNum(screen.width, 'screen.width'), height: toNum(screen.height, 'screen.height') },
      activeWindow: parseAppWindow(json.activeWindow),
    }
  }

  private async capture(
    windowId: number | undefined,
    opts: CaptureOptions,
  ): Promise<CapturedImage> {
    const args: Array<string | number> = ['-OutPath', opts.outPath]
    if (windowId !== undefined) {
      args.push('-WindowId', windowId)
    }
    if (opts.region !== undefined) {
      args.push('-X1', opts.region.x1, '-Y1', opts.region.y1, '-X2', opts.region.x2, '-Y2', opts.region.y2)
    }
    if (opts.maxEdge !== undefined) {
      args.push('-MaxEdge', opts.maxEdge)
    }
    const json = await this.runner.run('screenshot.ps1', args, { timeoutMs: 60_000 })
    const image: CapturedImage = {
      path: toStr(json.path),
      width: toNum(json.width, 'screenshot.width'),
      height: toNum(json.height, 'screenshot.height'),
    }
    if (windowId !== undefined) {
      image.window = windowId
    }
    return image
  }

  captureScreen(opts: CaptureOptions): Promise<CapturedImage> {
    return this.capture(undefined, opts)
  }

  async cropImage(opts: CropOptions): Promise<CropResult> {
    const args: Array<string | number> = [
      '-InPath', opts.sourcePath,
      '-X1', opts.region.x1, '-Y1', opts.region.y1, '-X2', opts.region.x2, '-Y2', opts.region.y2,
      '-OutPath', opts.outPath,
    ]
    const json = await this.runner.run('crop.ps1', args, { timeoutMs: 30_000 })
    const sourceEcho = (json.source ?? {}) as Record<string, unknown>
    return {
      path: toStr(json.path),
      width: toNum(json.width, 'crop.width'),
      height: toNum(json.height, 'crop.height'),
      source: {
        path: toStr(sourceEcho.path ?? opts.sourcePath),
        width: toNum(sourceEcho.width, 'crop.source.width'),
        height: toNum(sourceEcho.height, 'crop.source.height'),
      },
      region: opts.region,
    }
  }

  captureWindow(windowId: number, opts: CaptureOptions): Promise<CapturedImage> {
    return this.capture(windowId, opts)
  }

  async sendInput(evt: InputEvent): Promise<void> {
    const args: Array<string | number> = ['-Op', evt.kind]
    switch (evt.kind) {
      case 'click':
        args.push('-X', evt.x, '-Y', evt.y, '-Button', evt.button, '-Count', evt.count)
        if (evt.mods.length > 0) {
          args.push('-Mods', evt.mods.join(','))
        }
        break
      case 'key':
        args.push('-Vk', evt.vk, '-Extended', evt.extended ? 1 : 0)
        if (evt.mods.length > 0) {
          args.push('-Mods', evt.mods.join(','))
        }
        break
      case 'scroll':
        args.push(
          '-X', evt.x, '-Y', evt.y,
          '-Direction', evt.direction, '-Amount', evt.amount,
        )
        break
      case 'drag':
        args.push('-FromX', evt.fromX, '-FromY', evt.fromY, '-ToX', evt.toX, '-ToY', evt.toY)
        break
      case 'move':
        args.push('-X', evt.x, '-Y', evt.y)
        break
    }
    await this.runner.run('input.ps1', args)
  }

  async uiaTree(opts: UiaTreeOptions): Promise<UiaTreeResult> {
    const args: Array<string | number> = ['-Mode', opts.mode]
    if (opts.windowId !== undefined) {
      args.push('-WindowId', opts.windowId)
    }
    if (opts.pid !== undefined) {
      args.push('-TargetPid', opts.pid)
    }
    if (opts.mode === 'tree') {
      args.push(
        '-MaxDepth', opts.maxDepth ?? 4,
        '-MaxNodes', opts.maxNodes ?? 4000,
        '-OutPath', opts.outPath ?? '',
      )
      const json = await this.runner.run('uia-tree.ps1', args, { timeoutMs: 120_000 })
      return {
        kind: 'tree',
        file: toStr(json.file),
        count: toNum(json.count, 'tree.count'),
        truncated: json.truncated === true,
      }
    }
    args.push(
      '-MaxDepth', opts.maxDepth ?? 10,
      '-MaxElements', opts.maxElements ?? 200,
      '-MaxVisited', opts.maxVisited ?? 20_000,
    )
    const json = await this.runner.run('uia-tree.ps1', args, { timeoutMs: 120_000 })
    const rawElements = Array.isArray(json.elements) ? json.elements : []
    return {
      kind: 'elements',
      elements: rawElements.map((el, i) => parseElement(el, i)),
      truncated: json.truncated === true,
    }
  }

  async clipboardType(text: string): Promise<void> {
    await this.runner.run('clipboard-type.ps1', ['-Text', text], { timeoutMs: 30_000 })
  }

  async probe(probeOpts?: { echo?: string }): Promise<ProbeInfo> {
    const base = await this.runner.probe()
    let echo: string | undefined
    if (probeOpts?.echo !== undefined) {
      const json = await this.runner.run('echo.ps1', ['-Text', probeOpts.echo])
      echo = typeof json.echo === 'string' ? json.echo : undefined
    }
    return { version: base.version, latencyMs: base.latencyMs, elevated: base.elevated, echo }
  }
}
