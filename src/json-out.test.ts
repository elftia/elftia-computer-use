import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeErrorJson, writeJson } from './json-out.js'

const chunks: string[] = []
const spy = vi
  .spyOn(process.stdout, 'write')
  .mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })

afterEach(() => {
  chunks.length = 0
})

describe('JSON stdout contract', () => {
  it('success writer emits exactly one JSON object with ok:true', () => {
    writeJson({ ok: true, path: 'x.png', width: 10 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].endsWith('\n')).toBe(true)
    expect(JSON.parse(chunks[0])).toEqual({ ok: true, path: 'x.png', width: 10 })
  })

  it('error writer emits the D9 error shape', () => {
    writeErrorJson('ESTALE', 'window gone; re-run get-state')
    expect(chunks).toHaveLength(1)
    const parsed = JSON.parse(chunks[0]) as { ok: boolean; error: { code: string; message: string } }
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('ESTALE')
    expect(parsed.error.message).toContain('get-state')
  })

  it('never emits multiple objects', () => {
    writeJson({ ok: true })
    writeJson({ ok: true })
    expect(chunks).toHaveLength(2)
    for (const chunk of chunks) {
      expect(() => JSON.parse(chunk)).not.toThrow()
    }
    spy.mockRestore()
  })
})
