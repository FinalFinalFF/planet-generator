/**
 * Server-side merge for the photo library's shared curation (favorites,
 * hidden photos, site-wide framing). Used by every server that answers
 * `<library>/prefs`: the Vite dev middleware, orbgen, and the hosted
 * library's Pages Function — so the protocol cannot drift between them.
 *
 *   GET  <library>/prefs   → PhotoPrefs
 *   POST <library>/prefs   ← PrefsDiff, → the merged PhotoPrefs
 *
 * Clients send *changes*, never whole documents, so two people curating at
 * once do not overwrite each other: last write wins per photo, not per file.
 * The client half (building diffs) is `src/lib/photoPrefs.ts`; keep the two in
 * step.
 *
 * PhotoPrefs: { favorites: string[], hidden: string[], framing: { [id]: { zoom, focusX, focusY } } }
 * PrefsDiff:  { favorites?: { add?, remove? }, hidden?: { add?, remove? },
 *               framing?: { set?: { [id]: framing }, remove?: string[] } }
 */

const MAX_IDS = 20000

const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length < 300) : [])

const clampFraming = (f) => ({
  zoom: Math.max(1, Math.min(8, Number(f?.zoom) || 1)),
  focusX: Math.max(0, Math.min(1, Number.isFinite(f?.focusX) ? f.focusX : 0.5)),
  focusY: Math.max(0, Math.min(1, Number.isFinite(f?.focusY) ? f.focusY : 0.5)),
})

export function emptyPrefs() {
  return { favorites: [], hidden: [], framing: {} }
}

/** Coerce anything stored or received into a valid PhotoPrefs. */
export function sanitizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const framing = {}
  for (const [id, f] of Object.entries(r.framing ?? {})) {
    if (typeof id === 'string' && f && typeof f === 'object') framing[id] = clampFraming(f)
  }
  return { favorites: ids(r.favorites).slice(0, MAX_IDS), hidden: ids(r.hidden).slice(0, MAX_IDS), framing }
}

/** Apply a client's diff to stored prefs; returns new prefs (input untouched). */
export function applyPrefsDiff(stored, diff) {
  const base = sanitizePrefs(stored)
  const d = diff && typeof diff === 'object' ? diff : {}
  const list = (current, change) => {
    const set = new Set(current)
    for (const id of ids(change?.add)) set.add(id)
    for (const id of ids(change?.remove)) set.delete(id)
    return [...set].slice(0, MAX_IDS)
  }
  const framing = { ...base.framing }
  for (const [id, f] of Object.entries(d.framing?.set ?? {})) {
    if (typeof id === 'string' && f && typeof f === 'object') framing[id] = clampFraming(f)
  }
  for (const id of ids(d.framing?.remove)) delete framing[id]
  return {
    favorites: list(base.favorites, d.favorites),
    hidden: list(base.hidden, d.hidden),
    framing,
  }
}
