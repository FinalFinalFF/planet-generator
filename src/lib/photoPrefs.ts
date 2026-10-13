/**
 * App-level photo curation: favorites, hidden photos, and each photo's
 * site-wide framing (focal point + default zoom). Like the pattern library's
 * include list, this is a property of the *library*, not of any document —
 * documents still snapshot framing into their pool entries and cells, so a
 * preset or an API run stays reproducible.
 *
 * Persisted twice: localStorage (always, per browser) and, where the local
 * photo library is served (dev server, orbgen), `photo-library/prefs.json` on
 * disk — so orbgen and the MCP tools see the same favorites and framing as the
 * editor. That file sits beside the client photos and is untracked with them.
 */

import { createContext, useContext } from 'react'
import { PHOTO_LIBRARY_BASE, type PhotoMeta } from './photos'
import type { PoolPhoto } from '../types'

export type Framing = Pick<PoolPhoto, 'zoom' | 'focusX' | 'focusY'>

export type PhotoPrefs = {
  favorites: string[]
  hidden: string[]
  /** Site-wide framing overrides, by photo id. Absent = the detected default. */
  framing: Record<string, Framing>
}

export const EMPTY_PREFS: PhotoPrefs = { favorites: [], hidden: [], framing: {} }

const KEY = 'orbgen.photoPrefs.v1'
const FILE = `${PHOTO_LIBRARY_BASE}/prefs.json`

function sanitize(raw: unknown): PhotoPrefs {
  const r = (raw ?? {}) as Partial<PhotoPrefs>
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const framing: Record<string, Framing> = {}
  for (const [id, f] of Object.entries(r.framing ?? {})) {
    if (!f || typeof f !== 'object') continue
    framing[id] = {
      zoom: Math.max(1, Math.min(8, Number(f.zoom) || 1)),
      focusX: Math.max(0, Math.min(1, Number.isFinite(f.focusX) ? f.focusX : 0.5)),
      focusY: Math.max(0, Math.min(1, Number.isFinite(f.focusY) ? f.focusY : 0.5)),
    }
  }
  return { favorites: ids(r.favorites), hidden: ids(r.hidden), framing }
}

/** Disk copy first (shared with orbgen), then this browser's copy. */
export async function loadPhotoPrefs(): Promise<{ prefs: PhotoPrefs; onDisk: boolean }> {
  try {
    const res = await fetch(FILE, { cache: 'no-store' })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      return { prefs: sanitize(await res.json()), onDisk: true }
    }
  } catch {
    // no local library server — fall through
  }
  try {
    return { prefs: sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null')), onDisk: false }
  } catch {
    return { prefs: EMPTY_PREFS, onDisk: false }
  }
}

export async function savePhotoPrefs(prefs: PhotoPrefs, toDisk: boolean): Promise<void> {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage full or blocked — the disk copy (if any) still saves
  }
  if (!toDisk) return
  await fetch(FILE, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prefs),
  }).catch(() => undefined)
}

/** The framing a photo gets wherever it is placed: the site-wide override, else detected. */
export function framingFor(meta: PhotoMeta | undefined, prefs: PhotoPrefs, id?: string): Framing {
  const key = meta?.id ?? id ?? ''
  return prefs.framing[key] ?? { zoom: 1, focusX: meta?.focusX ?? 0.5, focusY: meta?.focusY ?? 0.5 }
}

export type PhotoPrefsApi = {
  prefs: PhotoPrefs
  setFavorite: (id: string, on: boolean) => void
  setHidden: (id: string, on: boolean) => void
  /**
   * Set a photo's site-wide framing. Also reframes it in the current document
   * (pool entry + every cell showing it), with `coalesce` folding a drag into
   * one undo entry there.
   */
  reframe: (id: string, framing: Partial<Framing>, coalesce?: string) => void
  /** Drop the override, back to the detected focal point. */
  resetFraming: (id: string) => void
}

export const PhotoPrefsContext = createContext<PhotoPrefsApi>({
  prefs: EMPTY_PREFS,
  setFavorite: () => {},
  setHidden: () => {},
  reframe: () => {},
  resetFraming: () => {},
})

export function usePhotoPrefs(): PhotoPrefsApi {
  return useContext(PhotoPrefsContext)
}
