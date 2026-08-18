import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArgv, type Invocation } from '../args.js'
import { FakeBackend } from '../testing/fake-backend.js'
import { runCrop } from './crop.js'

function invok(argv: string[]) {
  const parsed = parseArgv(argv)
  if (parsed.kind !== 'command') throw new Error('expected command')
  return parsed.invocation
}

describe('crop args', () => {
  it('parses --in and --region', () => {
    const inv = invok(['crop', '--in', 'shot.png', '--region', '10,20,110,220'])
    expect(inv).toMatchObject({
      command: 'crop',
      in: 'shot.png',
      region: { x1: 10, y1: 20, x2: 110, y2: 220 },
    })
  })

  it('rejects a non-4-integer region', () => {
    expect(() => invok(['crop', '--in', 'a.png', '--region', '10,20,110'])).toThrow(/four integers/)
    expect(() => invok(['crop', '--in', 'a.png', '--region', 'a,b,c,d'])).toThrow(/four integers/)
  })

  it('rejects empty or inverted regions', () => {
    expect(() => invok(['crop', '--in', 'a.png', '--region', '10,20,10,40'])).toThrow(/x2 > x1/)
    expect(() => invok(['crop', '--in', 'a.png', '--region', '10,20,110,20'])).toThrow(/y2 > y1/)
  })

  it('rejects negative origins', () => {
    expect(() => invok(['crop', '--in', 'a.png', '--region', '-5,20,110,220'])).toThrow(/non-negative/)
  })

  it('requires --in', () => {
    expect(() => invok(['crop', '--region', '0,0,10,10'])).toThrow(/requires --in/)
  })

  it('screenshot --region parses and excludes --window', () => {
    const inv = invok(['screenshot', '--region', '0,0,800,600'])
    expect(inv).toMatchObject({ command: 'screenshot', region: { x1: 0, y1: 0, x2: 800, y2: 600 } })
    expect(() => invok(['screenshot', '--window', '123', '--region', '0,0,10,10'])).toThrow(
      /either --window or --region/,
    )
  })
})

describe('runCrop', () => {
  it('returns actual crop dims plus source echo and region', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cu-crop-'))
    const src = join(dir, 'src.png')
    writeFileSync(src, 'png')
    const backend = new FakeBackend()
    const inv = invok(['crop', '--in', src, '--region', '100,50,400,250', '--out', dir]) as Extract<
      Invocation,
      { command: 'crop' }
    >
    const payload = await runCrop(inv, { backend, cwd: process.cwd() } as never)
    expect(payload).toMatchObject({
      ok: true,
      action: 'crop',
      width: 300,
      height: 200,
      region: [100, 50, 400, 250],
    })
    expect((payload as { source: { path: string } }).source.path).toBe(src)
  })
})
