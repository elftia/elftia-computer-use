import type { Modifier } from '../keys.js'

export type PlatformOs = 'windows' | 'macos' | 'linux' | 'unsupported'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface AppWindow {
  id: number
  pid: number
  title: string
  appName: string
  bounds: Rect
}

/** Live desktop facts (no screenshot, no UIA walk). */
export interface RawState {
  cursor: { x: number; y: number }
  screen: { width: number; height: number }
  activeWindow: AppWindow
}

export interface CapturedImage {
  path: string
  width: number
  height: number
  window?: number
}

export type InputEvent =
  | {
      kind: 'click'
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      count: 1 | 2 | 3
      mods: Modifier[]
    }
  | { kind: 'key'; vk: number; extended: boolean; mods: Modifier[] }
  | {
      kind: 'scroll'
      x: number
      y: number
      direction: 'up' | 'down' | 'left' | 'right'
      amount: number
    }
  | { kind: 'drag'; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'move'; x: number; y: number }

export interface UiaElementSummary {
  index: number
  role: string
  name: string
  controlType: string
  bounds: Rect
  center: { x: number; y: number }
}

export type UiaTreeResult =
  | { kind: 'tree'; file: string; count: number; truncated: boolean }
  | { kind: 'elements'; elements: UiaElementSummary[]; truncated: boolean }

export interface UiaTreeOptions {
  mode: 'tree' | 'elements'
  windowId?: number
  pid?: number
  maxDepth?: number
  maxNodes?: number
  maxElements?: number
  maxVisited?: number
  outPath?: string
}

export interface CaptureOptions {
  outPath: string
  maxEdge?: number
  /** Screen-absolute capture rect (screenshot --region). Mutually exclusive
   * with window capture at the command layer. */
  region?: Region
}

/** Integer pixel rect, inclusive-exclusive corners (x2 > x1, y2 > y1). */
export interface Region {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface CropOptions {
  sourcePath: string
  region: Region
  outPath: string
}

/** Result of cropping an existing image file (zoom semantics: no re-capture). */
export interface CropResult {
  path: string
  width: number
  height: number
  source: { path: string; width: number; height: number }
  region: Region
}

export interface ProbeInfo {
  version: string
  latencyMs: number
  elevated: boolean
  echo?: string
}

/**
 * The one seam behind which all native desktop behavior lives (design D4).
 * Command modules talk only to this interface, so the full suite runs on any
 * OS against injected fakes.
 */
export interface PlatformBackend {
  readonly os: PlatformOs
  listApps(): Promise<AppWindow[]>
  getState(): Promise<RawState>
  captureScreen(opts: CaptureOptions): Promise<CapturedImage>
  captureWindow(windowId: number, opts: CaptureOptions): Promise<CapturedImage>
  /** Crop an existing image file to a region (in the SOURCE image's own pixel
   * coordinate frame). Pure image operation — never touches the live screen. */
  cropImage(opts: CropOptions): Promise<CropResult>
  sendInput(evt: InputEvent): Promise<void>
  uiaTree(opts: UiaTreeOptions): Promise<UiaTreeResult>
  clipboardType(text: string): Promise<void>
  /** doctor support: PowerShell availability/version/latency/elevation plus an
   * optional UTF-8 echo round-trip through the script channel. */
  probe(opts?: { echo?: string }): Promise<ProbeInfo>
}
