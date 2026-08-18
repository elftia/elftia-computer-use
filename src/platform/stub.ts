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
  UiaTreeOptions,
  UiaTreeResult,
} from './types.js'

/**
 * Honest failure on platforms without an implementation (frozen contract):
 * every platform-backed op exits non-0 with ENOTSUPPORTED naming the OS.
 * Help/version are handled before platform dispatch and always work.
 */
export class StubBackend implements PlatformBackend {
  readonly os: PlatformOs

  constructor(os: PlatformOs) {
    this.os = os
  }

  private fail(op: string): never {
    throw new CliError('ENOTSUPPORTED', `${op} is not yet supported on ${this.os}`)
  }

  async listApps(): Promise<AppWindow[]> {
    this.fail('apps')
  }

  async getState(): Promise<RawState> {
    this.fail('get-state')
  }

  async captureScreen(_opts: CaptureOptions): Promise<CapturedImage> {
    this.fail('screenshot')
  }

  async captureWindow(_windowId: number, _opts: CaptureOptions): Promise<CapturedImage> {
    this.fail('screenshot --window')
  }

  async sendInput(_evt: InputEvent): Promise<void> {
    this.fail('input injection')
  }

  async uiaTree(_opts: UiaTreeOptions): Promise<UiaTreeResult> {
    this.fail('uia-tree')
  }

  async clipboardType(_text: string): Promise<void> {
    this.fail('type')
  }

  async probe(_opts?: { echo?: string }): Promise<ProbeInfo> {
    this.fail('doctor probe')
  }
}
