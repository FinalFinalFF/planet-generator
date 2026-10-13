/**
 * App-level photo curation: favorites, hidden photos, and each photo's
 * site-wide framing (focal point + default zoom). Like the pattern library's
 * include list, this is a property of the *library*, not of any document —
 * documents still snapshot framing into their pool entries and cells, so a
 * preset or an API run stays reproducible.
 *
 * Shared through the library's `/prefs` endpoint wherever there is one: the
 * dev server and orbgen (backed by `photo-library/prefs.json`) and the hosted
 * library's Pages Function (backed by KV, shared by the whole team). Clients
 * send *diffs*, merged server-side (`tools/photo-library/prefs-merge.mjs` —
 * keep the two halves in step), so concurrent curators do not overwrite each
 * other. With no endpoint (the public site), prefs live in localStorage.
 */

import { createContext, useContext } from 'react'
import { PHOTO_LIBRARY_BASE, type PhotoMeta } from './photos'
import { PHOTO_SOURCE } from './photoSource'
import type { PoolPhoto } from '../types'

export type Framing = Pick<PoolPhoto, 'zoom' | 'focusX' | 'focusY'>

export type PhotoPrefs = {
  favorites: string[]
  hidden: string[]
  /** Site-wide framing overrides, by photo id. Absent = the detected default. */
  framing: Record<string, Framing>
}

/** A change to curation — what a client sends. */
export type PrefsDiff = {
  favorites?: { add?: string[]; remove?: string[] }
  hidden?: { add?: string[]; remove?: string[] }
  framing?: { set?: Record<string, Framing>; remove?: string[] }
}

export const EMPTY_PREFS: PhotoPrefs = { favorites: [], hidden: [], framing: {} }

const KEY = 'orbgen.photoPrefs.v1'
const ENDPOINT = `${PHOTO_LIBRARY_BASE}/prefs`

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

/** Same semantics as the server's `applyPrefsDiff`. */
export function applyPrefsDiff(prefs: PhotoPrefs, d: PrefsDiff): PhotoPrefs {
  const list = (current: string[], change?: { add?: string[]; remove?: string[] }) => {
    if (!change) return current
    const set = new Set(current)
    for (const id of change.add ?? []) set.add(id)
    for (const id of change.remove ?? []) set.delete(id)
    return [...set]
  }
  const framing = { ...prefs.framing, ...(d.framing?.set ?? {}) }
  for (const id of d.framing?.remove ?? []) delete framing[id]
  return { favorites: list(prefs.favorites, d.favorites), hidden: list(prefs.hidden, d.hidden), framing }
}

/** Fold a queue of diffs into one, later changes winning per photo. */
export function combineDiffs(diffs: PrefsDiff[]): PrefsDiff {
  const fav = new Map<string, boolean>()
  const hid = new Map<string, boolean>()
  const frame = new Map<string, Framing | null>()
  for (const d of diffs) {
    for (const id of d.favorites?.add ?? []) fav.set(id, true)
    for (const id of d.favorites?.remove ?? []) fav.set(id, false)
    for (const id of d.hidden?.add ?? []) hid.set(id, true)
    for (const id of d.hidden?.remove ?? []) hid.set(id, false)
    for (const [id, f] of Object.entries(d.framing?.set ?? {})) frame.set(id, f)
    for (const id of d.framing?.remove ?? []) frame.set(id, null)
  }
  const pick = (m: Map<string, boolean>, v: boolean) => [...m].filter(([, x]) => x === v).map(([id]) => id)
  return {
    favorites: { add: pick(fav, true), remove: pick(fav, false) },
    hidden: { add: pick(hid, true), remove: pick(hid, false) },
    framing: {
      set: Object.fromEntries([...frame].filter(([, f]) => f !== null) as [string, Framing][]),
      remove: [...frame].filter(([, f]) => f === null).map(([id]) => id),
    },
  }
}

export type PrefsBackend = { shared: boolean; writable: boolean }

function readLocal(): PhotoPrefs {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return EMPTY_PREFS
  }
}

/** The shared endpoint's prefs, or this browser's copy where there is none. */
export async function loadPhotoPrefs(): Promise<{ prefs: PhotoPrefs; backend: PrefsBackend }> {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      return {
        prefs: sanitize(await res.json()),
        backend: { shared: true, writable: res.headers.get('x-orbgen-writable') !== '0' },
      }
    }
  } catch {
    // no library server here (the public site) — fall through
  }
  return { prefs: readLocal(), backend: { shared: false, writable: true } }
}

/**
 * Send a diff; resolves with the merged prefs the server now holds. Without a
 * shared endpoint the diff applies to this browser's copy.
 */
export async function pushPrefsDiff(diff: PrefsDiff, backend: PrefsBackend): Promise<PhotoPrefs> {
  if (!backend.shared) {
    const next = applyPrefsDiff(readLocal(), diff)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // storage full or blocked
    }
    return next
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(PHOTO_SOURCE.key ? { 'x-orbgen-key': PHOTO_SOURCE.key } : {}),
    },
    body: JSON.stringify(diff),
  })
  if (!res.ok) throw new Error(res.status === 403 ? 'not allowed to edit shared curation' : `HTTP ${res.status}`)
  return sanitize(await res.json())
}

/** The framing a photo gets wherever it is placed: the site-wide override, else detected. */
export function framingFor(meta: PhotoMeta | undefined, prefs: PhotoPrefs, id?: string): Framing {
  const key = meta?.id ?? id ?? ''
  return prefs.framing[key] ?? { zoom: 1, focusX: meta?.focusX ?? 0.5, focusY: meta?.focusY ?? 0.5 }
}

export type PhotoPrefsApi = {
  prefs: PhotoPrefs
  /** Where curation lives: shared (a library server) or this browser; editable or not. */
  backend: PrefsBackend & { remote: boolean }
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
  backend: { shared: false, writable: true, remote: false },
  setFavorite: () => {},
  setHidden: () => {},
  reframe: () => {},
  resetFraming: () => {},
})

export function usePhotoPrefs(): PhotoPrefsApi {
  return useContext(PhotoPrefsContext)
}
