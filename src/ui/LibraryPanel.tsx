/**
 * The pattern library manager: every pattern the app knows — built-ins,
 * procedural textures, imports — with an include/exclude toggle that curates
 * what Remix (and the pickers) deal from. Excluding is non-destructive: a
 * document already wearing an excluded pattern keeps rendering it, and the
 * pickers keep showing the one a layer or cell currently uses.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { ParsedPattern } from '../lib/patterns/parse'
import { loadPattern, recolor, resolveTokens } from '../lib/patterns/registry'

export type LibraryEntry = { id: string; name: string; imported: boolean }

export type LibraryPanelProps = {
  entries: LibraryEntry[]
  disabled: Set<string>
  parsedById: Map<string, ParsedPattern>
  onToggle: (id: string, included: boolean) => void
  onRemoveImport: (id: string) => void
  onAddFiles: (files: File[]) => void
  /** Feed a freshly parsed pattern back into App's cache. */
  onParsed: (parsed: ParsedPattern) => void
  onClose: () => void
}

function Thumb({ parsed }: { parsed: ParsedPattern | undefined }) {
  const markup = useMemo(() => {
    if (!parsed) return null
    // Neutral proof: light plate, near-black inks — the library is about
    // texture, not the current palette.
    const paints = parsed.groups.map((g) =>
      g.isBackground ? { hex: '#f2f2f0', alpha: 1 } : { hex: '#141414', alpha: 1 },
    )
    return recolor(parsed, resolveTokens(parsed, paints), `lib-${parsed.id}`)
  }, [parsed])
  if (!parsed || !markup) return <div className="lib__thumb lib__thumb--empty">…</div>
  return (
    <svg
      className="lib__thumb"
      viewBox={`0 0 ${parsed.width} ${parsed.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}

export function LibraryPanel({
  entries,
  disabled,
  parsedById,
  onToggle,
  onRemoveImport,
  onAddFiles,
  onParsed,
  onClose,
}: LibraryPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  // Thumbnails need every pattern parsed; the background warm-up usually has
  // them already, this catches stragglers.
  useEffect(() => {
    for (const e of entries) {
      if (!parsedById.has(e.id)) {
        loadPattern(e.id).then(onParsed).catch(() => undefined)
      }
    }
  }, [entries, parsedById, onParsed])

  const included = entries.filter((e) => !disabled.has(e.id)).length

  return (
    <div className="batch" role="dialog" aria-label="Pattern library">
      <div className="batch__bar">
        <span className="batch__title">Pattern library</span>
        <span className="section__hint">
          {included} of {entries.length} in the deal
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Add SVGs…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            onAddFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="note" style={{ padding: '0 15px' }}>
        Ticked patterns are what Remix and the pickers deal from. Un-ticking never breaks a
        composition that already uses one. Dropping .svg files anywhere adds them too.
      </div>
      <div className="lib__grid">
        {entries.map((e) => {
          const on = !disabled.has(e.id)
          return (
            <figure key={e.id} className={`lib__cell${on ? '' : ' lib__cell--off'}`}>
              <Thumb parsed={parsedById.get(e.id)} />
              <figcaption className="lib__meta">
                <label className="check" title={on ? 'In the remix deal' : 'Excluded from the deal'}>
                  <input type="checkbox" checked={on} onChange={(ev) => onToggle(e.id, ev.target.checked)} />
                  <span className="lib__name" title={e.name}>
                    {e.name}
                    {e.imported ? ' (imported)' : e.id.startsWith('tx-') ? ' (procedural)' : ''}
                  </span>
                </label>
                {e.imported && (
                  <button
                    type="button"
                    className="btn btn--tiny"
                    title="Delete this imported pattern"
                    onClick={() => onRemoveImport(e.id)}
                  >
                    delete
                  </button>
                )}
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
