/**
 * Minimal ZIP writer — store method only, no dependency.
 *
 * Deflate is skipped deliberately: PNGs are already compressed, and pulling in a
 * compression library to save a little on the SVG text is not worth a dependency
 * in an app that otherwise ships only React. `store` is a valid ZIP method, so
 * the archives open everywhere.
 */

export type ZipEntry = {
  /** Path inside the archive. Forward slashes only. */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS packed time/date, which is what the ZIP format stores. */
function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

const LOCAL_HEADER = 30
const CENTRAL_HEADER = 46
const EOCD = 22

export function createZip(entries: ZipEntry[], now = new Date()): Blob {
  const { time, date } = dosStamp(now)
  const encoder = new TextEncoder()

  const prepared = entries.map((e) => {
    const nameBytes = encoder.encode(e.name)
    return { nameBytes, data: e.data, crc: crc32(e.data) }
  })

  const localSize = prepared.reduce(
    (sum, p) => sum + LOCAL_HEADER + p.nameBytes.length + p.data.length,
    0,
  )
  const centralSize = prepared.reduce((sum, p) => sum + CENTRAL_HEADER + p.nameBytes.length, 0)

  const out = new Uint8Array(localSize + centralSize + EOCD)
  const view = new DataView(out.buffer)
  let offset = 0

  // Offsets of each local header, needed by the central directory.
  const localOffsets: number[] = []

  for (const p of prepared) {
    localOffsets.push(offset)
    view.setUint32(offset, 0x04034b50, true) // local file header signature
    view.setUint16(offset + 4, 20, true) // version needed
    view.setUint16(offset + 6, 0x0800, true) // flags: UTF-8 names
    view.setUint16(offset + 8, 0, true) // method: store
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, date, true)
    view.setUint32(offset + 14, p.crc, true)
    view.setUint32(offset + 18, p.data.length, true) // compressed size
    view.setUint32(offset + 22, p.data.length, true) // uncompressed size
    view.setUint16(offset + 26, p.nameBytes.length, true)
    view.setUint16(offset + 28, 0, true) // extra field length
    offset += LOCAL_HEADER
    out.set(p.nameBytes, offset)
    offset += p.nameBytes.length
    out.set(p.data, offset)
    offset += p.data.length
  }

  const centralStart = offset

  prepared.forEach((p, i) => {
    view.setUint32(offset, 0x02014b50, true) // central directory signature
    view.setUint16(offset + 4, 20, true) // version made by
    view.setUint16(offset + 6, 20, true) // version needed
    view.setUint16(offset + 8, 0x0800, true) // flags
    view.setUint16(offset + 10, 0, true) // method
    view.setUint16(offset + 12, time, true)
    view.setUint16(offset + 14, date, true)
    view.setUint32(offset + 16, p.crc, true)
    view.setUint32(offset + 20, p.data.length, true)
    view.setUint32(offset + 24, p.data.length, true)
    view.setUint16(offset + 28, p.nameBytes.length, true)
    view.setUint16(offset + 30, 0, true) // extra
    view.setUint16(offset + 32, 0, true) // comment
    view.setUint16(offset + 34, 0, true) // disk number start
    view.setUint16(offset + 36, 0, true) // internal attributes
    view.setUint32(offset + 38, 0, true) // external attributes
    view.setUint32(offset + 42, localOffsets[i], true)
    offset += CENTRAL_HEADER
    out.set(p.nameBytes, offset)
    offset += p.nameBytes.length
  })

  view.setUint32(offset, 0x06054b50, true) // end of central directory
  view.setUint16(offset + 4, 0, true) // this disk
  view.setUint16(offset + 6, 0, true) // disk with central directory
  view.setUint16(offset + 8, prepared.length, true) // entries on this disk
  view.setUint16(offset + 10, prepared.length, true) // total entries
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true) // comment length

  return new Blob([out], { type: 'application/zip' })
}

export const textEntry = (name: string, text: string): ZipEntry => ({
  name,
  data: new TextEncoder().encode(text),
})

export async function blobEntry(name: string, blob: Blob): Promise<ZipEntry> {
  return { name, data: new Uint8Array(await blob.arrayBuffer()) }
}
