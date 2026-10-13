/**
 * The photo library, full page — the photo counterpart of the pattern
 * library. Curation here is app-level, not per document: favorites, hidden
 * photos and each photo's site-wide framing (focal point + default zoom) live
 * in `photoPrefs` and follow a photo into every pool, cell and API run. The
 * one document-level action is pool membership, for the open document.
 *
 * Keys (with a photo selected): ← → move, F favorite, P pool, H hide, Esc close.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { fullUrlFor, usePhotoLibrary, type PhotoMeta } from '../lib/photos'
import { framingFor, usePhotoPrefs } from '../lib/photoPrefs'
import { FocalPointPicker } from './FocalPointPicker'
import { Slider } from './controls'

export type View = 'pool' | 'all' | 'selects' | 'favorites' | 'hidden'

const PAGE = 120

export type PhotoLibraryPanelProps = {
  /** Photo ids in the open document's pool. */
  poolIds: Set<string>
  onTogglePool: (meta: PhotoMeta, on: boolean) => void
  onAddToPool: (metas: PhotoMeta[]) => void
  onClearPool: () => void
  /** Which view to open on — the sidebar's "View pool" opens on the pool. */
  initialView?: View
  onClose: () => void
}

export function PhotoLibraryPanel({
  poolIds,
  onTogglePool,
  onAddToPool,
  onClearPool,
  initialView,
  onClose,
}: PhotoLibraryPanelProps) {
  const library = usePhotoLibrary()
  const { prefs, backend, setFavorite, setHidden, reframe, resetFraming } = usePhotoPrefs()
  const [view, setView] = useState<View>(initialView ?? 'selects')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const favorites = useMemo(() => new Set(prefs.favorites), [prefs.favorites])
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of library.list) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [library.list])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return library.list.filter((m) => {
      // The pool view shows the open document's pool as it is — hidden
      // photos included, since they are in it and can be taken out here.
      if (view === 'pool') {
        if (!poolIds.has(m.id)) return false
      } else if (view === 'hidden' ? !hidden.has(m.id) : hidden.has(m.id)) return false
      if (view === 'selects' && !(m.selects || m.origin === 'upload')) return false
      if (view === 'favorites' && !favorites.has(m.id)) return false
      if (tag && !m.tags.includes(tag)) return false
      if (q && !m.name.toLowerCase().includes(q) && !m.tags.some((t) => t.toLowerCase().includes(q))) return false
      return true
    })
  }, [library.list, view, tag, query, favorites, hidden, poolIds])

  // Reset paging whenever the filter changes.
  useEffect(() => setShown(PAGE), [view, tag, query])

  // Infinite scroll: grow the page when the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [items])

  const selected = selectedId ? library.byId.get(selectedId) : undefined
  const index = selected ? items.findIndex((m) => m.id === selected.id) : -1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'Escape') {
        if (selected) setSelectedId(null)
        else onClose()
        return
      }
      if (!selected || e.metaKey || e.ctrlKey) return
      const key = e.key.toLowerCase()
      const move = (d: number) => {
        const next = items[Math.max(0, Math.min(items.length - 1, index + d))]
        if (next) {
          setSelectedId(next.id)
          if (index + d >= shown) setShown((n) => n + PAGE)
        }
      }
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (key === 'f') setFavorite(selected.id, !favorites.has(selected.id))
      else if (key === 'p') onTogglePool(selected, !poolIds.has(selected.id))
      else if (key === 'h') setHidden(selected.id, !hidden.has(selected.id))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // Capture, so F/P/H never reach the editor's global shortcuts.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, index, items, shown, favorites, hidden, poolIds, setFavorite, setHidden, onTogglePool, onClose])

  // Keep the selected tile in view as the arrows move.
  useEffect(() => {
    if (selectedId) document.getElementById(`ph-${selectedId}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const counts = {
    pool: poolIds.size,
    all: library.list.filter((m) => !hidden.has(m.id)).length,
    selects: library.list.filter((m) => !hidden.has(m.id) && (m.selects || m.origin === 'upload')).length,
    favorites: library.list.filter((m) => favorites.has(m.id) && !hidden.has(m.id)).length,
    hidden: hidden.size,
  }

  const framing = selected ? framingFor(selected, prefs) : null
  const overridden = selected ? !!prefs.framing[selected.id] : false

  return (
    <div className="batch photolib" role="dialog" aria-label="Photo library">
      <div className="batch__bar">
        <span className="batch__title">Photo library</span>
        <span
          className="section__hint"
          title={
            backend.shared
              ? 'Favorites, hidden photos and focal points are shared with everyone using this library.'
              : 'Favorites, hidden photos and focal points are saved in this browser only.'
          }
        >
          {backend.remote ? 'team library' : 'local library'} ·{' '}
          {backend.shared ? (backend.writable ? 'shared curation' : 'shared curation, read-only') : 'curation in this browser'}
        </span>
        <div className="seg" role="group" aria-label="Show">
          {(['pool', 'selects', 'favorites', 'all', 'hidden'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`seg__btn${view === v ? ' seg__btn--on' : ''}`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'pool' ? 'in pool' : v} ({counts[v]})
            </button>
          ))}
        </div>
        <select className="select photolib__folder" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Folder">
          <option value="">All folders</option>
          {tags.map(([t, n]) => (
            <option key={t} value={t}>
              {t} ({n})
            </option>
          ))}
        </select>
        <input
          className="text photolib__search"
          type="search"
          placeholder="Search names and folders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search photos"
        />
        <span style={{ flex: 1 }} />
        <span className="section__hint">
          {items.length} shown · {poolIds.size} in this pool
        </span>
        <button
          type="button"
          className="btn"
          disabled={poolIds.size === 0}
          title="Remove every photo from the open document's pool (they stay in the library). ⌘Z undoes it."
          onClick={onClearPool}
        >
          Clear pool
        </button>
        <button
          type="button"
          className="btn"
          disabled={items.length === 0}
          title="Add 12 random photos from this view to the open document's pool"
          onClick={() => {
            const candidates = items.filter((m) => !poolIds.has(m.id))
            const picked: PhotoMeta[] = []
            while (picked.length < 12 && candidates.length > 0) {
              picked.push(candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0])
            }
            onAddToPool(picked)
          }}
        >
          + 12 random to pool
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className={`photolib__body${selected ? ' photolib__body--detail' : ''}`}>
        <div className="photolib__scroll">
          {items.length === 0 ? (
            <div className="note" style={{ padding: 15 }}>
              {view === 'pool'
                ? 'The pool is empty — add photos from the other views (P, or double-click).'
                : view === 'favorites'
                ? 'No favorites yet — select a photo and press F (or ★) to favorite it.'
                : view === 'hidden'
                  ? 'Nothing hidden. Hidden photos stay out of every view and every random pick.'
                  : 'No photos match.'}
            </div>
          ) : (
            <div className="photolib__grid">
              {items.slice(0, shown).map((m) => (
                <button
                  key={m.id}
                  id={`ph-${m.id}`}
                  type="button"
                  className={`photolib__tile${selectedId === m.id ? ' photolib__tile--selected' : ''}`}
                  title={`${m.name} — click to open, double-click to ${poolIds.has(m.id) ? 'remove from' : 'add to'} the pool`}
                  onClick={() => setSelectedId(m.id)}
                  onDoubleClick={() => onTogglePool(m, !poolIds.has(m.id))}
                >
                  <img src={m.thumbUrl} alt={m.name} loading="lazy" draggable={false} />
                  {favorites.has(m.id) && <span className="photolib__badge photolib__badge--fav">★</span>}
                  {poolIds.has(m.id) && <span className="photolib__badge photolib__badge--pool">✓</span>}
                </button>
              ))}
            </div>
          )}
          {items.length > shown && <div ref={sentinel} className="photolib__sentinel" />}
        </div>

        {selected && framing && (
          <aside className="photolib__detail" aria-label="Photo details">
            <div className="photolib__detailhead">
              <strong className="photolib__name" title={selected.name}>
                {selected.name}
              </strong>
              <button type="button" className="btn btn--tiny" onClick={() => setSelectedId(null)}>
                ×
              </button>
            </div>
            <FocalPointPicker
              src={fullUrlFor(selected)}
              width={selected.width}
              height={selected.height}
              focusX={framing.focusX}
              focusY={framing.focusY}
              maxHeight={440}
              onChange={(focusX, focusY) => reframe(selected.id, { focusX, focusY }, `lib-${selected.id}-focus`)}
            />
            <div className="note">
              {overridden ? 'Focal point set by hand. ' : selected.faces ? `Focal point from ${selected.faces} detected face${selected.faces === 1 ? '' : 's'}. ` : 'No faces detected — centered. '}
              Click or drag to move it; it applies everywhere this photo is used.
            </div>
            <Slider
              label="Default zoom"
              value={framing.zoom}
              min={1}
              max={4}
              onChange={(zoom) => reframe(selected.id, { zoom }, `lib-${selected.id}-zoom`)}
            />
            <div className="photolib__actions">
              <button
                type="button"
                className={`btn${favorites.has(selected.id) ? ' btn--on' : ''}`}
                aria-pressed={favorites.has(selected.id)}
                onClick={() => setFavorite(selected.id, !favorites.has(selected.id))}
              >
                ★ Favorite <kbd>F</kbd>
              </button>
              <button
                type="button"
                className={`btn${poolIds.has(selected.id) ? ' btn--on' : ''}`}
                aria-pressed={poolIds.has(selected.id)}
                onClick={() => onTogglePool(selected, !poolIds.has(selected.id))}
              >
                In pool <kbd>P</kbd>
              </button>
              <button
                type="button"
                className={`btn${hidden.has(selected.id) ? ' btn--on' : ''}`}
                aria-pressed={hidden.has(selected.id)}
                onClick={() => setHidden(selected.id, !hidden.has(selected.id))}
              >
                Hide <kbd>H</kbd>
              </button>
              {overridden && (
                <button type="button" className="btn" onClick={() => resetFraming(selected.id)}>
                  Reset focal point
                </button>
              )}
            </div>
            <dl className="photolib__meta">
              <dt>Folders</dt>
              <dd>{selected.tags.join(' · ')}</dd>
              <dt>Size</dt>
              <dd>
                {selected.width} × {selected.height}
              </dd>
              <dt>Position</dt>
              <dd>
                {index + 1} of {items.length} — ← → to step
              </dd>
            </dl>
          </aside>
        )}
      </div>
    </div>
  )
}
