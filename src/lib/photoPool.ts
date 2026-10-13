/**
 * Pure document edits for photos: cells, pool membership and framing. Shared
 * by the sidebar (cell editor, Photos section) and App (site-wide reframing
 * from the photo library), so "reframe a photo" means one thing everywhere.
 */

import type { OrbDoc, PoolPhoto, SectorFill } from '../types'
import type { Framing } from './photoPrefs'

export const framingOf = (p: Framing): Framing => ({ zoom: p.zoom, focusX: p.focusX, focusY: p.focusY })

/** Only the framing keys a patch actually sets. */
export function framingPatch(p: Partial<Framing>): Partial<Framing> {
  const out: Partial<Framing> = {}
  if (p.zoom !== undefined) out.zoom = p.zoom
  if (p.focusX !== undefined) out.focusX = p.focusX
  if (p.focusY !== undefined) out.focusY = p.focusY
  return out
}

export function withCell(d: OrbDoc, rowKey: 'rowA' | 'rowB', i: number, cell: SectorFill): OrbDoc {
  const row = d.orb.sectors[rowKey].map((f, j) => (j === i ? cell : f))
  return { ...d, orb: { ...d.orb, sectors: { ...d.orb.sectors, [rowKey]: row } } }
}

/** Reframe a photo everywhere in a document: its pool entry and every cell showing it. */
export function withPhotoFraming(d: OrbDoc, photoId: string, framing: Partial<Framing>): OrbDoc {
  const fix = (f: SectorFill): SectorFill =>
    f.kind === 'photo' && f.photoId === photoId ? { ...f, ...framing } : f
  return {
    ...d,
    photoPool: {
      ...d.photoPool,
      photos: d.photoPool.photos.map((p) => (p.photoId === photoId ? { ...p, ...framing } : p)),
    },
    orb: {
      ...d.orb,
      sectors: { ...d.orb.sectors, rowA: d.orb.sectors.rowA.map(fix), rowB: d.orb.sectors.rowB.map(fix) },
    },
  }
}

export function withPoolPhoto(d: OrbDoc, entry: PoolPhoto, on: boolean): OrbDoc {
  const without = d.photoPool.photos.filter((p) => p.photoId !== entry.photoId)
  return { ...d, photoPool: { ...d.photoPool, photos: on ? [...without, entry] : without } }
}

/** Does this document use the photo anywhere (pool or a cell)? */
export function docUsesPhoto(d: OrbDoc, photoId: string): boolean {
  return (
    d.photoPool.photos.some((p) => p.photoId === photoId) ||
    [...d.orb.sectors.rowA, ...d.orb.sectors.rowB].some((f) => f.kind === 'photo' && f.photoId === photoId)
  )
}
