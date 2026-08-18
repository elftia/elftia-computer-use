import { describe, expect, it } from 'vitest'
import { isPngMagic, readPngDims } from './png-dims.js'
import { makePng } from './testing/png-fixture.js'

describe('PNG dimension parsing', () => {
  it('reads dims from a real generated PNG', () => {
    expect(readPngDims(makePng(37, 19))).toEqual({ width: 37, height: 19 })
    expect(readPngDims(makePng(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('validates the magic header', () => {
    expect(isPngMagic(makePng(1, 1))).toBe(true)
    expect(isPngMagic(Buffer.from('definitely not a png'))).toBe(false)
    expect(isPngMagic(Buffer.alloc(4))).toBe(false)
  })

  it('rejects truncated and non-IHDR buffers', () => {
    const png = makePng(5, 5)
    expect(readPngDims(png.subarray(0, 10))).toBeNull()
    const wrongChunk = Buffer.from(png)
    wrongChunk.write('XXXX', 12, 'ascii')
    expect(readPngDims(wrongChunk)).toBeNull()
  })
})
