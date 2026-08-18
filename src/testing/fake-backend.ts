import { writeFileSync } from 'node:fs'
import { CliError } from '../errors.js'
import type {
  AppWindow,
  CapturedImage,
  CaptureOptions,
  InputEvent,
  PlatformBackend,
  PlatformOs,
  ProbeInfo,
  RawState,
  UiaElementSummary,
  UiaTreeOptions,
  UiaTreeResult,
} from '../platform/types.js'
import { makePng } from './png-fixture.js'

export const FAKE_WINDOWS: AppWindow[] = [
  {
    id: 1001,
    pid: 4242,
    title: 'Notes — 记事本',
    appName: 'notepad',
    bounds: { x: 100, y: 100, width: 800, height: 600 },
  },
  {
    id: 2002,
    pid: 5151,
    title: 'Browser',
    appName: 'chrome',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  },
]

export const FAKE_ELEMENTS: UiaElementSummary[] = [
  {
    index: 0,
    role: 'edit',
    name: 'Search 你好',
    controlType: 'Edit',
    bounds: { x: 120, y: 150, width: 400, height: 28 },
    center: { x: 320, y: 164 },
  },
  {
    index: 1,
    role: 'button',
    name: 'OK',
    controlType: 'Button',
    bounds: { x: 560, y: 150, width: 80, height: 28 },
    center: { x: 600, y: 164 },
  },
]

export interface FakeBackendOptions {
  os?: PlatformOs
  apps?: AppWindow[]
  rawState?: RawState
  elements?: UiaElementSummary[]
  elementsTruncated?: boolean
  treeCount?: number
  probeInfo?: ProbeInfo
  probeError?: CliError
  captureError?: CliError
  /** Reported capture dims (defaults to 1920x1080 / 800x600). */
  captureDims?: { width: number; height: number }
  /** When false, nothing is written to disk (dims checks then fail). */
  writeRealPng?: boolean
  /** Written PNG dims when different from the reported ones (mismatch tests). */
  pngDimsOverride?: { width: number; height: number }
  /** Forces probe() to return this echo regardless of the requested fixture. */
  echoResponse?: string
}

/**
 * In-memory PlatformBackend for unit tests: records every input event and
 * clipboard text, writes real (tiny) PNGs so read-back checks can run.
 */
export class FakeBackend implements PlatformBackend {
  readonly os: PlatformOs
  readonly inputEvents: InputEvent[] = []
  readonly clipboardTexts: string[] = []
  readonly captureCalls: Array<{ outPath: string; maxEdge?: number; window?: number }> = []
  readonly uiaTreeCalls: UiaTreeOptions[] = []
  stateCalls = 0

  private readonly opts: FakeBackendOptions

  constructor(options: FakeBackendOptions = {}) {
    this.opts = options
    this.os = options.os ?? 'windows'
  }

  async listApps(): Promise<AppWindow[]> {
    if (this.opts.apps !== undefined) {
      return [...this.opts.apps]
    }
    return FAKE_WINDOWS.map((w) => ({ ...w, bounds: { ...w.bounds } }))
  }

  async getState(): Promise<RawState> {
    this.stateCalls += 1
    if (this.opts.rawState !== undefined) {
      return this.opts.rawState
    }
    const activeWindow = FAKE_WINDOWS[0]
    return {
      cursor: { x: 512, y: 384 },
      screen: { width: 1920, height: 1080 },
      activeWindow: { ...activeWindow, bounds: { ...activeWindow.bounds } },
    }
  }

  async captureScreen(captureOpts: CaptureOptions): Promise<CapturedImage> {
    if (this.opts.captureError !== undefined) {
      throw this.opts.captureError
    }
    this.captureCalls.push({ outPath: captureOpts.outPath, maxEdge: captureOpts.maxEdge })
    const dims = this.opts.captureDims ?? { width: 1920, height: 1080 }
    if (this.opts.writeRealPng !== false) {
      const pngDims = this.opts.pngDimsOverride ?? dims
      writeFileSync(captureOpts.outPath, makePng(pngDims.width, pngDims.height))
    }
    return { path: captureOpts.outPath, width: dims.width, height: dims.height }
  }

  async captureWindow(
    windowId: number,
    captureOpts: CaptureOptions,
  ): Promise<CapturedImage> {
    if (this.opts.captureError !== undefined) {
      throw this.opts.captureError
    }
    this.captureCalls.push({
      outPath: captureOpts.outPath,
      maxEdge: captureOpts.maxEdge,
      window: windowId,
    })
    const dims = this.opts.captureDims ?? { width: 800, height: 600 }
    if (this.opts.writeRealPng !== false) {
      const pngDims = this.opts.pngDimsOverride ?? dims
      writeFileSync(captureOpts.outPath, makePng(pngDims.width, pngDims.height))
    }
    return { path: captureOpts.outPath, width: dims.width, height: dims.height, window: windowId }
  }

  async sendInput(evt: InputEvent): Promise<void> {
    this.inputEvents.push(evt)
  }

  async uiaTree(treeOpts: UiaTreeOptions): Promise<UiaTreeResult> {
    this.uiaTreeCalls.push({ ...treeOpts })
    if (treeOpts.mode === 'tree') {
      const count = this.opts.treeCount ?? FAKE_ELEMENTS.length
      const file = treeOpts.outPath ?? ''
      if (file !== '') {
        writeFileSync(file, JSON.stringify({ schema: 1, count, truncated: false, root: null }))
      }
      return { kind: 'tree', file, count, truncated: false }
    }
    return {
      kind: 'elements',
      elements: this.opts.elements ?? FAKE_ELEMENTS,
      truncated: this.opts.elementsTruncated ?? false,
    }
  }

  async clipboardType(text: string): Promise<void> {
    this.clipboardTexts.push(text)
  }

  async probe(probeOpts?: { echo?: string }): Promise<ProbeInfo> {
    if (this.opts.probeError !== undefined) {
      throw this.opts.probeError
    }
    const base = this.opts.probeInfo ?? {
      version: '5.1.26100.8875',
      latencyMs: 240,
      elevated: false,
    }
    const echo =
      this.opts.echoResponse !== undefined ? this.opts.echoResponse : probeOpts?.echo
    return { ...base, echo }
  }
}
