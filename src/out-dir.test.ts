import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliError } from './errors.js'
import { ensureDir, resolveOutDir, timestampDirName } from './out-dir.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cucu-outdir-'))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('out-dir resolution', () => {
  it('defaults to <cwd>/.computer-use/<timestamp>/', () => {
    const now = new Date(2026, 7, 18, 12, 0, 0, 5)
    expect(timestampDirName(now)).toBe('20260818-120000-005')
    expect(resolveOutDir({ cwd, now: () => now })).toBe(
      join(cwd, '.computer-use', '20260818-120000-005'),
    )
  })

  it('resolves a relative --out against cwd', () => {
    const dir = resolveOutDir({ cwd, now: () => new Date() }, 'shots')
    expect(dir).toBe(join(cwd, 'shots'))
  })

  it('keeps an absolute --out as-is', () => {
    const absolute = join(cwd, 'elsewhere')
    expect(resolveOutDir({ cwd, now: () => new Date() }, absolute)).toBe(absolute)
  })

  it('ensureDir creates nested directories', () => {
    const dir = join(cwd, 'a', 'b', 'c')
    expect(ensureDir(dir)).toBe(dir)
  })

  it('ensureDir maps failures to EIO', () => {
    const file = join(cwd, 'plain-file')
    writeFileSync(file, 'x')
    let caught: unknown
    try {
      ensureDir(join(file, 'sub'))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CliError)
    expect((caught as CliError).code).toBe('EIO')
  })
})
