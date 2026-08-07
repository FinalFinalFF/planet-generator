/**
 * Batch mode: an N-up grid of seeded remixes from the current settings, so a
 * run can be cherry-picked rather than stepped through one Remix at a time.
 *
 * Each cell is a real `OrbSvg`, which is what lets "export all" serialize the
 * live nodes exactly like the single-file export does.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Palette, OrbDoc } from '../types'
import { OrbSvg } from '../render/OrbSvg'
import { pickPalette, remix } from '../lib/remix'
import { paletteById } from '../lib/palettes'
import type { ParsedPattern } from '../lib/patterns/parse'
import { Check, Segmented } from './controls'

export type BatchPanelProps = {
  doc: OrbDoc
  palettes: Palette[]
  parsedById: Map<string, ParsedPattern>
  available: ParsedPattern[]
  transparent: boolean
  busy: boolean
  format: 'svg' | 'png' | 'both'
  pngSize: number
  onFormatChange: (f: 'svg' | 'png' | 'both') => void
  onPngSizeChange: (n: number) => void
  onClose: () => void
  onPromote: (doc: OrbDoc) => void
  onExportAll: (cells: BatchCell[], nodes: Map<string, SVGSVGElement>) => void
}

export type BatchCell = {
  seed: string
  doc: OrbDoc
  palette: Palette
}

/**
 * One cell, memoized.
 *
 * Without this, every keystroke or slider frame in the editor re-renders all
 * 9–25 cells even when `cells` itself is unchanged, because a parent render
 * re-renders children regardless of prop identity. `cell` comes straight out of
 * the `cells` memo, and `onNode`/`onPromote` are stable, so an unchanged cell
 * costs nothing. Fidelity is untouched — this changes *when* a cell renders,
 * never *what* it renders, which is what keeps batch export byte-identical to a
 * promoted-then-exported document.
 */
const BatchCellView = memo(function BatchCellView({
  cell,
  parsedById,
  onNode,
  onPromote,
}: {
  cell: BatchCell
  parsedById: Map<string, ParsedPattern>
  onNode: (seed: string, el: SVGSVGElement | null) => void
  onPromote: (doc: OrbDoc) => void
}) {
  const ref = useCallback((el: SVGSVGElement | null) => onNode(cell.seed, el), [cell.seed, onNode])
  return (
    <figure className="batch__cell">
      <OrbSvg
        doc={cell.doc}
        palette={cell.palette}
        parsedById={parsedById}
        svgRef={ref}
        // Ids must be unique per cell: every one of these lives in the same
        // document, and defs are referenced by id.
        idPrefix={`b${cell.seed.replace(/[^a-z0-9]/gi, '')}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      <figcaption className="batch__meta">
        <span className="batch__seed" title={`${cell.seed} · ${cell.palette.name}`}>
          {cell.seed}
        </span>
        <button
          type="button"
          className="btn btn--tiny"
          onClick={() => onPromote(cell.doc)}
          title="Load this into the editor"
        >
          Promote
        </button>
      </figcaption>
    </figure>
  )
})

const GRID_OPTIONS = [
  { value: '3', label: '3 × 3' },
  { value: '4', label: '4 × 4' },
  { value: '5', label: '5 × 5' },
] as const

function newBatchSeed(): string {
  return `batch-${Math.random().toString(36).slice(2, 8)}`
}

export function BatchPanel({
  doc,
  palettes,
  parsedById,
  available,
  transparent,
  busy,
  format,
  pngSize,
  onFormatChange,
  onPngSizeChange,
  onClose,
  onPromote,
  onExportAll,
}: BatchPanelProps) {
  const [cols, setCols] = useState<'3' | '4' | '5'>('3')
  const [batchSeed, setBatchSeed] = useState(newBatchSeed)
  const [varyPalette, setVaryPalette] = useState(false)
  const nodes = useRef(new Map<string, SVGSVGElement>())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * The grid is derived from the document, so a slider drag in the editor would
   * otherwise re-deal all 25 cells on every frame — 25 `remix()` calls and 25
   * full renders per input event, which measured 22× the cost of the same drag
   * with the panel shut. Deferring means an urgent render (the slider) keeps the
   * cells it already has, and the re-deal happens at low priority once the drag
   * stops. Intermediate states are skipped rather than queued, and the cells
   * still end up showing the current document.
   */
  const deferredDoc = useDeferredValue(doc)

  const cells = useMemo<BatchCell[]>(() => {
    // Shadowed deliberately: everything below must read the deferred document,
    // never the live prop.
    const doc = deferredDoc
    const n = Number(cols) ** 2
    // Cell seeds derive from the batch seed, so a batch is reproducible and
    // regenerating is just a new batch seed.
    return Array.from({ length: n }, (_, i) => {
      const seed = `${batchSeed}-${i + 1}`
      const palette =
        varyPalette && !doc.locks.colors
          ? pickPalette(palettes, seed, doc.paletteId)
          : paletteById(palettes, doc.paletteId)
      const source = varyPalette ? { ...doc, paletteId: palette.id } : doc
      return { seed, doc: remix(source, seed, { available, palette }), palette }
    })
  }, [cols, batchSeed, varyPalette, deferredDoc, palettes, available])

  // Stable identity: a fresh callback per render would defeat the memo on
  // BatchCellView, and would also make React detach and re-attach every ref.
  const onNode = useCallback((seed: string, el: SVGSVGElement | null) => {
    if (el) nodes.current.set(seed, el)
    else nodes.current.delete(seed)
  }, [])

  return (
    <div className="batch" role="dialog" aria-label="Batch remixes">
      <div className="batch__bar">
        <span className="batch__title">Batch</span>
        <Segmented
          value={cols}
          options={GRID_OPTIONS}
          onChange={(v) => setCols(v as '3' | '4' | '5')}
        />
        <span className="eyebrow">{cells.length} remixes</span>
        <input
          className="text"
          style={{ width: 150 }}
          value={batchSeed}
          aria-label="Batch seed"
          onChange={(e) => setBatchSeed(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => setBatchSeed(newBatchSeed())}>
          Regenerate
        </button>
        <Check
          label={doc.locks.colors ? 'Vary palette (colors locked)' : 'Vary palette'}
          checked={varyPalette && !doc.locks.colors}
          onChange={setVaryPalette}
        />

        <span className="header__spacer" />

        <span className="eyebrow">{transparent ? 'transparent bg' : 'opaque bg'}</span>
        <div className="seg" style={{ width: 150, flex: 'none' }} role="group" aria-label="Export format">
          {(['svg', 'png', 'both'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`seg__btn${f === format ? ' seg__btn--on' : ''}`}
              aria-pressed={f === format}
              onClick={() => onFormatChange(f)}
            >
              {f}
            </button>
          ))}
        </div>
        {format !== 'svg' && (
          <select
            className="select"
            style={{ width: 88 }}
            value={pngSize}
            aria-label="PNG long edge"
            onChange={(e) => onPngSizeChange(Number(e.target.value))}
          >
            {[512, 1024, 2048].map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => onExportAll(cells, nodes.current)}
        >
          {busy ? 'Zipping…' : 'Export all (zip)'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div
        className="batch__grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => (
          <BatchCellView
            key={cell.seed}
            cell={cell}
            parsedById={parsedById}
            onNode={onNode}
            onPromote={onPromote}
          />
        ))}
      </div>
    </div>
  )
}
