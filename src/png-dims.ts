const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IHDR_TAG = 0x49484452

export function isPngMagic(buf: Buffer): boolean {
  return buf.length >= 8 && PNG_MAGIC.equals(buf.subarray(0, 8))
}

/** Parse width/height out of the IHDR chunk (bytes 16..23) without deps. */
export function readPngDims(buf: Buffer): { width: number; height: number } | null {
  if (!isPngMagic(buf) || buf.length < 24) {
    return null
  }
  if (buf.readUInt32BE(12) !== IHDR_TAG) {
    return null
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
