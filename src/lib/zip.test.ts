/**
 * ZIP byte-level smoke test.
 *
 * `lib/zip.ts` is hand-rolled, and a wrong CRC or central-directory offset
 * produces an archive that only fails when the user opens it. This walks the
 * bytes directly — no `unzip` binary, so it runs anywhere.
 */

import { describe, expect, it } from 'vitest'
import { createZip, textEntry } from './zip'

/** Independent CRC-32, so the check is not just zip.ts agreeing with itself. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const ENTRIES = [
  { name: 'orb-alpha.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  { name: 'nested/orb-beta.svg', text: '<svg/>'.repeat(50) },
]

async function build() {
  const blob = createZip(
    ENTRIES.map((e) => textEntry(e.name, e.text)),
    new Date('2026-07-29T12:34:56'),
  )
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { blob, bytes, view: new DataView(bytes.buffer) }
}

describe('createZip', () => {
  it('produces an application/zip blob', async () => {
    const { blob } = await build()
    expect(blob.type).toBe('application/zip')
  })

  it('writes an end-of-central-directory record with the right counts', async () => {
    const { bytes, view } = await build()
    const eocd = bytes.length - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 8, true)).toBe(ENTRIES.length) // entries on this disk
    expect(view.getUint16(eocd + 10, true)).toBe(ENTRIES.length) // total entries
    const cdSize = view.getUint32(eocd + 12, true)
    const cdOffset = view.getUint32(eocd + 16, true)
    // The central directory must sit exactly between the file data and the EOCD.
    expect(cdOffset + cdSize).toBe(eocd)
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50)
  })

  it('writes local headers whose sizes and CRCs match the payload', async () => {
    const { bytes, view } = await build()
    const encoder = new TextEncoder()

    let offset = 0
    for (const entry of ENTRIES) {
      const expected = encoder.encode(entry.text)
      const nameBytes = encoder.encode(entry.name)

      expect(view.getUint32(offset, true)).toBe(0x04034b50) // local header signature
      expect(view.getUint16(offset + 8, true)).toBe(0) // method: store
      expect(view.getUint32(offset + 14, true)).toBe(crc32(expected))
      expect(view.getUint32(offset + 18, true)).toBe(expected.length) // compressed
      expect(view.getUint32(offset + 22, true)).toBe(expected.length) // uncompressed
      expect(view.getUint16(offset + 26, true)).toBe(nameBytes.length)

      const nameAt = offset + 30
      expect(new TextDecoder().decode(bytes.subarray(nameAt, nameAt + nameBytes.length))).toBe(
        entry.name,
      )

      // Stored, so the payload is the original bytes verbatim.
      const dataAt = nameAt + nameBytes.length
      expect(bytes.subarray(dataAt, dataAt + expected.length)).toEqual(expected)

      offset = dataAt + expected.length
    }
  })

  it('points each central-directory record at its local header', async () => {
    const { bytes, view } = await build()
    const eocd = bytes.length - 22
    const encoder = new TextEncoder()
    let cd = view.getUint32(eocd + 16, true)

    for (const entry of ENTRIES) {
      expect(view.getUint32(cd, true)).toBe(0x02014b50)
      const nameLen = view.getUint16(cd + 28, true)
      const localAt = view.getUint32(cd + 42, true)
      // Follow the pointer: it must land on a local header for this same name.
      expect(view.getUint32(localAt, true)).toBe(0x04034b50)
      const localNameAt = localAt + 30
      expect(
        new TextDecoder().decode(bytes.subarray(localNameAt, localNameAt + nameLen)),
      ).toBe(entry.name)
      // CRC recorded in both places must agree.
      expect(view.getUint32(cd + 16, true)).toBe(view.getUint32(localAt + 14, true))
      expect(view.getUint32(cd + 16, true)).toBe(crc32(encoder.encode(entry.text)))
      cd += 46 + nameLen
    }
    expect(cd).toBe(eocd)
  })
})
