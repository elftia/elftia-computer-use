import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliError } from './errors.js'
import type { AppWindow } from './platform/types.js'
import {
  findElement,
  findLiveWindow,
  isMinimizedRect,
  readState,
  rescalePoint,
  staleStateMessage,
  writeState,
  type StateFileV1,
} from './state.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cucu-state-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function sampleState(): StateFileV1 {
  return {
    schema: 1,
    createdAt: '2026-08-18T12:00:00.000Z',
    screen: { width: 1920, height: 1080 },
    cursor: { x: 512, y: 384 },
    activeWindow: {
      id: 1001,
      pid: 4242,
      title: 'Notes — 记事本',
      appName: 'notepad',
      bounds: { x: 100, y: 100, width: 800, height: 600 },
    },
    screenshot: { path: join(dir, 'screen.png'), width: 1920, height: 1080 },
    elements: [
      {
        index: 0,
        role: 'edit',
        name: 'Search 你好',
        controlType: 'Edit',
        bounds: { x: 120, y: 150, width: 400, height: 28 },
        center: { x: 320, y: 164 },
      },
      {
        index: 3,
        role: 'button',
        name: 'OK',
        controlType: 'Button',
        bounds: { x: 460, y: 376, width: 80, height: 24 },
        center: { x: 500, y: 388 },
      },
    ],
    elementsTruncated: false,
  }
}

describe('state file round-trip', () => {
  it('writeState → readState preserves schema v1 content', () => {
    const path = join(dir, 'state.json')
    writeState(path, sampleState())
    const loaded = readState(path)
    expect(loaded).toEqual(sampleState())
  })

  it('readState rejects missing, invalid, and future-schema files with EUSAGE', () => {
    const missing = join(dir, 'missing.json')
    expect(() => readState(missing)).toThrow(CliError)
    try {
      readState(missing)
    } catch (err) {
      expect((err as CliError).code).toBe('EUSAGE')
    }

    const badJson = join(dir, 'bad.json')
    writeFileSync(badJson, '{not json')
    expect(() => readState(badJson)).toThrow(/not valid JSON/)

    const future = join(dir, 'future.json')
    writeFileSync(future, JSON.stringify({ ...sampleState(), schema: 2 }))
    expect(() => readState(future)).toThrow(/unsupported schema 2/)
  })

  it('readState rejects structurally broken states', () => {
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, JSON.stringify({ schema: 1, screen: { width: 1 } }))
    expect(() => readState(broken)).toThrow(/missing required fields/)
  })

  it('findElement locates by index and misses cleanly', () => {
    const state = sampleState()
    expect(findElement(state, 3)?.name).toBe('OK')
    expect(findElement(state, 99)).toBeUndefined()
  })
})

describe('rescale math (design D7)', () => {
  it('translates a point when the window moved', () => {
    const target = rescalePoint(
      { x: 100, y: 100, width: 800, height: 600 },
      { x: 300, y: 200, width: 800, height: 600 },
      { x: 500, y: 388 },
    )
    expect(target).toEqual({ x: 700, y: 488 })
  })

  it('rescales when the window resized', () => {
    const target = rescalePoint(
      { x: 0, y: 0, width: 1000, height: 500 },
      { x: 0, y: 0, width: 500, height: 250 },
      { x: 250, y: 125 },
    )
    expect(target).toEqual({ x: 125, y: 63 })
  })

  it('handles moved AND resized windows together', () => {
    const target = rescalePoint(
      { x: 0, y: 0, width: 800, height: 600 },
      { x: 160, y: 120, width: 400, height: 300 },
      { x: 400, y: 300 },
    )
    expect(target).toEqual({ x: 360, y: 270 })
  })

  it('handles negative origins (multi-monitor)', () => {
    const target = rescalePoint(
      { x: -1920, y: 0, width: 1920, height: 1080 },
      { x: -1920, y: 200, width: 1920, height: 1080 },
      { x: -960, y: 540 },
    )
    expect(target).toEqual({ x: -960, y: 740 })
  })

  it('throws ESTALE on degenerate captured bounds', () => {
    expect(() =>
      rescalePoint({ x: 0, y: 0, width: 0, height: 600 }, { x: 0, y: 0, width: 10, height: 10 }, { x: 1, y: 1 }),
    ).toThrow(CliError)
    try {
      rescalePoint({ x: 0, y: 0, width: 800, height: 0 }, { x: 0, y: 0, width: 10, height: 10 }, { x: 1, y: 1 })
    } catch (err) {
      expect((err as CliError).code).toBe('ESTALE')
    }
  })
})

describe('live window matching', () => {
  const target: AppWindow = {
    id: 1001,
    pid: 4242,
    title: 'Notes',
    appName: 'notepad',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  }

  it('matches by window id first (window moved/resized still matches)', () => {
    const live = findLiveWindow(
      [{ ...target, bounds: { x: 900, y: 900, width: 400, height: 300 } }],
      target,
    )
    expect(live?.bounds.width).toBe(400)
  })

  it('falls back to pid + title when the handle is gone', () => {
    const live = findLiveWindow(
      [{ ...target, id: 777, title: 'Notes', bounds: { x: 1, y: 2, width: 3, height: 4 } }],
      target,
    )
    expect(live?.id).toBe(777)
  })

  it('returns null when nothing matches (stale)', () => {
    expect(
      findLiveWindow([{ ...target, id: 999, pid: 999, title: 'Other', bounds: { x: 0, y: 0, width: 1, height: 1 } }], target),
    ).toBeNull()
  })

  it('detects minimized windows parked at -32000', () => {
    expect(isMinimizedRect({ x: -32000, y: -32000, width: 160, height: 28 })).toBe(true)
    expect(isMinimizedRect({ x: -100, y: 50, width: 160, height: 28 })).toBe(false)
  })

  it('stale message advises a fresh get-state', () => {
    expect(staleStateMessage(target)).toContain('get-state')
    expect(staleStateMessage(target)).toContain('4242')
  })
})
