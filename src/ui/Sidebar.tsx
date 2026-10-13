import { useRef, useState } from 'react'
import {
  BLEND_MODES,
  MASK_MODES,
  ORB_TYPES,
  ORB_TYPE_LABELS,
  type AccentLayer,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type Layer,
  type LayerMask,
  type LockSection,
  type Palette,
  type PatternLayer,
  type OrbDoc,
  type OrbType,
  type Preset,
  type SectorFill,
  type ShadingLayer,
} from '../types'
import { Section } from './Section'
import {
  Adv,
  Check,
  ColorRefEditor,
  Field,
  Inert,
  NumberField,
  PropLock,
  Segmented,
  Select,
  Slider,
  MoreToggle,
  Scope,
  TextField,
  useTier,
} from './controls'
import { GradientEditor } from './GradientEditor'
import { ExportPanel, type ExportPanelProps } from './ExportPanel'
import { PalettePanel, type PalettePanelProps } from './PalettePanel'
import type { ParsedPattern } from '../lib/patterns/parse'
import { usePhotoLibrary, usePhotos, type Photo } from '../lib/photos'
import { framingFor, usePhotoPrefs } from '../lib/photoPrefs'
import { framingOf, framingPatch, withCell, withPoolPhoto } from '../lib/photoPool'
import { FocalPointPicker } from './FocalPointPicker'
import { MAX_PHOTOS_PER_ORB } from '../lib/defaults'
import { DEFAULT_LAYER_MASK, nextId } from '../lib/defaults'
import {
  PICKABLE_BRAND_GRADIENTS,
  brandGradientFor,
  nearestSlot,
  type BrandGradient,
} from '../lib/brand'
import type {
  CellPropertyLock,
  LayerPropertyLock,
  PhotoPool,
  PoolPhoto,
  PropertyLocks,
} from '../types'

/* ---------- the RSAC Spectrum Strip ---------- */

const CHAINED = PICKABLE_BRAND_GRADIENTS.filter((g) => g.chained)
const CROSS_LINKS = PICKABLE_BRAND_GRADIENTS.filter((g) => !g.chained)

const cssGradient = (g: BrandGradient): string =>
  `linear-gradient(90deg, ${g.stops
    .map((s) => `${s.hex} ${Math.round(s.offset * 100)}%`)
    .join(', ')})`

/**
 * Eight of the ten named brand gradients chain end-to-start into one master
 * spectrum, so the picker is one continuous strip you select a segment from —
 * not a dropdown of ten names. Energy and Contrast use off-chain hexes and sit
 * beneath as labeled cross-links, honestly presented as not-segments.
 */
function BrandGradientStrip({
  onPick,
  active,
}: {
  onPick?: (g: BrandGradient) => void
  /** Highlight the active preset; `undefined` = none / custom. */
  active?: string
}) {
  const pickable = !!onPick
  return (
    <div className="field">
      <div className="field__label">
        <span>{pickable ? 'Brand gradients' : 'The spectrum'}</span>
        {active && <span>{PICKABLE_BRAND_GRADIENTS.find((g) => g.id === active)?.name ?? ''}</span>}
      </div>
      <div className="bstrip" role={pickable ? 'group' : undefined} aria-label="RSAC named gradients">
        {CHAINED.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`bstrip__seg${active === g.id ? ' bstrip__seg--on' : ''}`}
            style={{ background: cssGradient(g) }}
            title={g.name}
            aria-label={`${g.name} gradient`}
            disabled={!pickable}
            onClick={() => onPick?.(g)}
          />
        ))}
      </div>
      <div className="bstrip__links">
        {CROSS_LINKS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`bstrip__link${active === g.id ? ' bstrip__link--on' : ''}`}
            title={`${g.name} — off-chain cross-link`}
            disabled={!pickable}
            onClick={() => onPick?.(g)}
          >
            <span className="bstrip__chipfill" style={{ background: cssGradient(g) }} />
            {g.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Which brand preset a gradient currently is, if any (by its stop ids). */
function activeBrandId(g: Gradient): string | undefined {
  const first = g.stops[0]?.id ?? ''
  const m = /^(rsac-[a-z]+)-s0$/.exec(first)
  return m && g.stops.every((s, i) => s.id === `${m[1]}-s${i}`) ? m[1] : undefined
}

/** A picker keeps showing the pattern its owner currently wears, even when
 *  the library manager has excluded it from the deal. */
function withCurrent(
  options: Array<{ id: string; name: string; imported: boolean }>,
  id: string | undefined,
  name: string,
): Array<{ id: string; name: string; imported: boolean }> {
  if (!id || options.some((o) => o.id === id)) return options
  return [...options, { id, name: `${name} (excluded)`, imported: false }]
}

/* ---------- lock-tree helpers ---------- */

const LAYER_PROPS: LayerPropertyLock[] = ['pattern', 'color', 'scale', 'position', 'rotation']
const CELL_PROPS: CellPropertyLock[] = ['fill', 'color', 'scale', 'rotation']

const countLocks = (locks: Partial<Record<string, boolean>> | undefined): number =>
  locks ? Object.values(locks).filter(Boolean).length : 0

const anyLock = (obj: { locks?: Partial<Record<string, boolean>> }): boolean =>
  countLocks(obj.locks) > 0

/** A property padlock that exists in the Advanced tier only — "maximum
 *  tuning" is definitionally advanced. Object-level chips stay in Simple. */
function AdvLock(props: Parameters<typeof PropLock>[0]) {
  return (
    <Adv>
      <PropLock {...props} />
    </Adv>
  )
}

/**
 * The object-level lock chip on a layer or cell card. None → all on;
 * some or all → clear. Partial state reads LOCK·n.
 */
function ObjectLockChip<K extends string>({
  locks,
  vocabulary,
  what,
  onChange,
}: {
  locks: PropertyLocks<K> | undefined
  vocabulary: K[]
  what: string
  onChange: (locks: PropertyLocks<K> | undefined) => void
}) {
  const n = countLocks(locks)
  const full = n === vocabulary.length
  const label = full ? 'LOCKED' : n > 0 ? `LOCK·${n}` : 'LOCK'
  const active = vocabulary.filter((k) => locks?.[k])
  return (
    <button
      type="button"
      className={`lock lock--mini${full ? ' lock--on' : ''}${!full && n > 0 ? ' lock--partial' : ''}`}
      title={
        n === 0
          ? `Freeze this ${what} against Remix — its own dice and the section dice included. Colors still follow the palette.`
          : full
            ? `This ${what} is frozen. Click to unlock everything on it.`
            : `Frozen on this ${what}: ${active.join(', ')}. Click to freeze it entirely.`
      }
      aria-pressed={n > 0}
      onClick={() =>
        onChange(
          n > 0 && !full
            ? Object.fromEntries(vocabulary.map((k) => [k, true])) as PropertyLocks<K>
            : full
              ? undefined
              : (Object.fromEntries(vocabulary.map((k) => [k, true])) as PropertyLocks<K>),
        )
      }
    >
      {label}
    </button>
  )
}

const BLEND_OPTIONS = BLEND_MODES.map((b) => ({ value: b, label: b }))
const MASK_OPTIONS = MASK_MODES.map((m) => ({
  value: m,
  label: m === 'orb' ? 'whole disc' : m === 'lens' ? 'lens' : 'outside lens',
}))

const ASPECTS = [
  { label: '1:1', w: 1600, h: 1600 },
  { label: '16:9', w: 1920, h: 1080 },
  { label: '4:5', w: 1440, h: 1800 },
  { label: '3:2', w: 1800, h: 1200 },
]

export type SidebarProps = {
  doc: OrbDoc
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  presets: Preset[]
  open: Record<string, boolean>
  onToggleSection: (key: string) => void
  selectedLayerId: string | null
  onSelectLayer: (id: string | null) => void
  update: (recipe: (d: OrbDoc) => OrbDoc, coalesce?: string) => void
  onAddPatternLayer: (patternId: string) => void
  onSetLayerPattern: (layerId: string, patternId: string) => void
  /** Point a sector cell at a texture/pattern, deriving its color groups. */
  onSetSectorTexture: (row: 'rowA' | 'rowB', index: number, patternId: string) => void
  /** Add an image file to the photo library; null when it could not be read. */
  onImportPhoto: (file: File) => Promise<Photo | null>
  onDeletePhoto: (id: string) => void
  palettePanel: Omit<PalettePanelProps, 'palette'>
  exportPanel: ExportPanelProps
  /** Switch the orb type through `applyOrbType` (lock-respecting). */
  onSetOrbType: (type: OrbType) => void
  /** Randomize one section, leaving the rest of the composition alone. */
  onRandomizeSection: (section: Exclude<LockSection, 'colors'>) => void
  /** The Palette section's dice picks a different palette. */
  onRandomizePalette: () => void
  /** Open the full-page photo library (favorites, framing, pool picks). */
  onOpenPhotoLibrary: () => void
  /** Built-in library plus anything imported this session. */
  patternOptions: Array<{ id: string; name: string; imported: boolean }>
}

/* ---------- small chrome ---------- */

/**
 * The standing-constraint chips (Flat, Solid fills, Hide orb): compact toggles
 * whose explainer lives in the tooltip — the house style for load-bearing
 * semantics. Accent-filled when on.
 */
function ConstraintChip({
  label,
  on,
  title,
  onToggle,
}: {
  label: string
  on: boolean
  title: string
  onToggle: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`chip${on ? ' chip--on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={() => onToggle(!on)}
    >
      {label}
    </button>
  )
}

/* ---------- sector-collage controls ---------- */

/** A palette-spread starter for a cell added by the row-count control. */
function defaultSectorFill(palette: Palette, index: number): SectorFill {
  const count = Math.max(1, palette.colors.length)
  return { kind: 'flat', color: { slot: (index * 3 + 1) % count } }
}

/** The ink a cell would keep when its fill kind changes — never destructive. */
function carriedInk(fill: SectorFill): ColorRef {
  if (fill.kind === 'flat') return fill.color
  if (fill.kind === 'ramp') return fill.from
  if (fill.kind === 'photo') return { slot: 1 }
  return fill.colors.find((c, i) => i > 0 && (c.alpha ?? 1) > 0.001) ?? { slot: 1 }
}

function SectorRowEditor({
  rowKey,
  label,
  row,
  palette,
  parsedById,
  patternOptions,
  photoPool,
  updateDoc,
  onChange,
  onSetTexture,
  onImportPhoto,
}: {
  rowKey: 'rowA' | 'rowB'
  label: string
  row: SectorFill[]
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  patternOptions: Array<{ id: string; name: string; imported: boolean }>
  photoPool: PhotoPool
  /** Whole-document edits, for photo changes that also touch the pool. */
  updateDoc: (recipe: (d: OrbDoc) => OrbDoc, coalesce?: string) => void
  onChange: (row: SectorFill[], coalesce?: string) => void
  onSetTexture: (row: 'rowA' | 'rowB', index: number, patternId: string) => void
  onImportPhoto: (file: File) => Promise<Photo | null>
}) {
  const library = usePhotoLibrary()
  const photoPrefs = usePhotoPrefs()
  // Per-cell disclosure, inheriting an opened parent scope (the Orb section's
  // own "more settings") so the wider toggle never closes a card back down.
  const parentAdvanced = useTier() === 'advanced'
  const [moreCells, setMoreCells] = useState<Record<number, boolean>>({})
  const setCount = (count: number) => {
    const next = row.slice(0, count)
    while (next.length < count) next.push(defaultSectorFill(palette, next.length + row.length))
    onChange(next)
  }
  const patchCell = (i: number, fill: SectorFill, coalesce?: string) =>
    onChange(
      row.map((f, j) => (j === i ? fill : f)),
      coalesce && `${rowKey}-${i}-${coalesce}`,
    )
  /**
   * Edit a photo cell and keep the pool in step, in one undo entry. Framing
   * belongs to the *photo* while it is in the pool — editing it here edits
   * the pool entry and every cell showing that photo, so Remix places it the
   * way it was just framed. A photo newly chosen for a cell joins the pool
   * (and wears its pool framing if it was already there); `pool` forces
   * membership either way.
   */
  const patchPhotoCell = (i: number, patch: Partial<PhotoFill>, coalesce?: string, pool?: boolean) => {
    const cur = row[i]
    const framing = framingPatch(patch)
    const onlyFraming =
      Object.keys(framing).length > 0 && Object.keys(patch).length === Object.keys(framing).length && pool === undefined
    // Framing is a property of the photo, site-wide: reframing it here
    // reframes it in the library, the pool and every cell showing it.
    if (onlyFraming && cur?.kind === 'photo' && cur.photoId) {
      photoPrefs.reframe(cur.photoId, framing, coalesce && `${rowKey}-${i}-${coalesce}`)
      return
    }
    updateDoc((d) => {
      const cur = d.orb.sectors[rowKey][i]
      if (!cur || cur.kind !== 'photo') return d
      const entryFor = (id: string) => d.photoPool.photos.find((p) => p.photoId === id)
      let cell: PhotoFill = { ...cur, ...patch }
      const switched = patch.photoId !== undefined && patch.photoId !== cur.photoId
      const pooledAlready = switched ? entryFor(cell.photoId) : undefined
      if (pooledAlready) cell = { ...cell, ...framingOf(pooledAlready) }
      let next = withCell(d, rowKey, i, cell)
      if (cell.photoId && (pool === true || (pool === undefined && switched)) && !entryFor(cell.photoId)) {
        next = withPoolPhoto(next, { photoId: cell.photoId, ...framingOf(cell) }, true)
      }
      if (pool === false) next = withPoolPhoto(next, { photoId: cell.photoId, ...framingOf(cell) }, false)
      return next
    }, coalesce && `${rowKey}-${i}-${coalesce}`)
  }
  // Prefer a procedural texture as the starting point; fall back to anything.
  const defaultTextureId =
    patternOptions.find((o) => o.id.startsWith('tx-'))?.id ?? patternOptions[0]?.id

  return (
    <>
      <div className="eyebrow">{label}</div>
      <Segmented
        label="Cells"
        value={String(Math.min(3, Math.max(1, row.length)))}
        options={[
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
        ]}
        onChange={(v) => setCount(Number(v))}
      />
      {row.map((fill, i) => {
        const parsed = fill.kind === 'texture' ? parsedById.get(fill.patternId) : undefined
        return (
          <Scope key={i} advanced={parentAdvanced || !!moreCells[i]}>
          <div className="layercard">
            <div className="layercard__head">
              <span className="layercard__title">Cell {i + 1}</span>
              <span className="layercard__hint">{fill.kind}</span>
              <MoreToggle
                on={parentAdvanced || !!moreCells[i]}
                what={`${label} cell ${i + 1}`}
                onToggle={(on) => setMoreCells((m) => ({ ...m, [i]: on }))}
              />
              <AdvLock
                on={!!fill.locks?.fill}
                title="Lock the fill: remix keeps this cell's kind and texture."
                onToggle={(on) =>
                  patchCell(i, { ...fill, locks: { ...fill.locks, fill: on } })
                }
              />
              <AdvLock
                on={!!fill.locks?.color}
                title="Lock the inks: remix keeps this cell's palette-slot assignments."
                onToggle={(on) =>
                  patchCell(i, { ...fill, locks: { ...fill.locks, color: on } })
                }
              />
              <ObjectLockChip
                locks={fill.locks}
                vocabulary={CELL_PROPS}
                what="segment"
                onChange={(locks) => patchCell(i, { ...fill, locks })}
              />
            </div>
            <Segmented
              value={fill.kind}
              options={[
                { value: 'flat', label: 'flat' },
                { value: 'ramp', label: 'ramp' },
                { value: 'texture', label: 'texture' },
                { value: 'photo', label: 'photo' },
              ]}
              onChange={(kind) => {
                if (kind === fill.kind) return
                if (kind === 'texture') {
                  if (defaultTextureId) onSetTexture(rowKey, i, defaultTextureId)
                  return
                }
                if (kind === 'photo') {
                  // Start on the first pool photo (with its framing), else
                  // the newest upload (which joins the pool), else an empty
                  // cell whose editor offers the upload. No fill lock: Remix
                  // keeps pool photos by re-placing them — lock the fill to
                  // pin one to this cell instead.
                  const first = photoPool.photos[0]
                  const newest = library.list.filter((m) => m.origin === 'upload').at(-1)
                  const start: PhotoFill = first
                    ? { kind: 'photo', ...first, locks: fill.locks }
                    : {
                        kind: 'photo',
                        photoId: newest?.id ?? '',
                        ...framingFor(newest, photoPrefs.prefs),
                        locks: fill.locks,
                      }
                  updateDoc((d) => {
                    const next = withCell(d, rowKey, i, start)
                    return start.photoId && !first
                      ? withPoolPhoto(next, { photoId: start.photoId, ...framingOf(start) }, true)
                      : next
                  })
                  return
                }
                // Keep the ink when switching kinds, so toggling is not
                // destructive; the cell's locks travel with it.
                const ink = carriedInk(fill)
                patchCell(
                  i,
                  kind === 'ramp'
                    ? {
                        kind: 'ramp',
                        from: ink,
                        to: { slot: Math.max(0, palette.colors.length - 1) },
                        angle: 90,
                        locks: fill.locks,
                      }
                    : { kind: 'flat', color: ink, locks: fill.locks },
                )
              }}
            />
            {fill.kind === 'flat' && (
              <ColorRefEditor
                name="Ink"
                value={fill.color}
                palette={palette}
                onChange={(color) => patchCell(i, { ...fill, color })}
              />
            )}
            {fill.kind === 'ramp' && (
              <>
                {/* Compact brand picker: a ramp cell wears a named gradient's
                    endpoints (Radiance's mid stop collapses — noted in title). */}
                <BrandGradientStrip
                  onPick={(g) => {
                    const first = g.stops[0]
                    const last = g.stops[g.stops.length - 1]
                    patchCell(i, {
                      ...fill,
                      from: { slot: nearestSlot(first.hex, palette), hex: first.hex },
                      to: { slot: nearestSlot(last.hex, palette), hex: last.hex },
                      angle: g.angle,
                    })
                  }}
                />
                <ColorRefEditor
                  name="Ramp from"
                  value={fill.from}
                  palette={palette}
                  onChange={(from) => patchCell(i, { ...fill, from })}
                />
                <ColorRefEditor
                  name="Ramp to"
                  value={fill.to}
                  palette={palette}
                  onChange={(to) => patchCell(i, { ...fill, to })}
                />
                <Adv>
                  <Slider
                    label="Ramp angle"
                    value={fill.angle}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    onChange={(angle) => patchCell(i, { ...fill, angle })}
                  />
                </Adv>
              </>
            )}
            {fill.kind === 'photo' && (
              <PhotoCellEditor
                fill={fill}
                photoPool={photoPool}
                onPool={(on) => patchPhotoCell(i, {}, undefined, on)}
                onPatch={(patch, coalesce) => patchPhotoCell(i, patch, coalesce)}
                onImportPhoto={onImportPhoto}
              />
            )}
            {fill.kind === 'texture' && (
              <>
                <Select
                  label="Texture"
                  value={fill.patternId}
                  options={withCurrent(patternOptions, fill.patternId, parsed?.name ?? fill.patternId).map((o) => ({
                    value: o.id,
                    label: o.imported ? `${o.name} (imported)` : o.name,
                  }))}
                  onChange={(id) => onSetTexture(rowKey, i, id)}
                />
                <Adv>
                  <Slider
                    label="Scale"
                    value={Math.max(1, fill.scale)}
                    min={1}
                    max={4}
                    tools={
                      <AdvLock
                        on={!!fill.locks?.scale}
                        title="Lock the texture scale against remix."
                        onToggle={(on) =>
                          patchCell(i, { ...fill, locks: { ...fill.locks, scale: on } })
                        }
                      />
                    }
                    onChange={(scale) => patchCell(i, { ...fill, scale })}
                  />
                  <Slider
                    label="Rotation"
                    value={fill.rotation}
                    min={0}
                    max={360}
                    step={1}
                    suffix="°"
                    tools={
                      <AdvLock
                        on={!!fill.locks?.rotation}
                        title="Lock the texture rotation against remix."
                        onToggle={(on) =>
                          patchCell(i, { ...fill, locks: { ...fill.locks, rotation: on } })
                        }
                      />
                    }
                    onChange={(rotation) => patchCell(i, { ...fill, rotation })}
                  />
                </Adv>
                {parsed?.groups.map((g) => (
                  <ColorRefEditor
                    key={g.index}
                    name={g.label}
                    chip={g.sample}
                    value={fill.colors[g.index] ?? { slot: g.index }}
                    palette={palette}
                    onChange={(c) =>
                      patchCell(i, {
                        ...fill,
                        colors: parsed.groups.map(
                          (gg, gi) => (gi === g.index ? c : (fill.colors[gi] ?? { slot: gg.index })),
                        ),
                      })
                    }
                  />
                ))}
              </>
            )}
          </div>
          </Scope>
        )
      })}
    </>
  )
}

type PhotoFill = Extract<SectorFill, { kind: 'photo' }>

/* ---------- photos ---------- */

/**
 * A photo cell: pick a photo (pool photos and uploads; the full library is
 * browsed in the Photos section), set the focal point, and zoom. The marked
 * spot is aimed at the cell's centre of mass (see the `photo` fill type), so
 * the subject stays in view in any cell shape the structure deals.
 */
function PhotoCellEditor({
  fill,
  photoPool,
  onPool,
  onPatch,
  onImportPhoto,
}: {
  fill: PhotoFill
  photoPool: PhotoPool
  onPool: (on: boolean) => void
  /** `coalesce` folds a drag or slide into one undo entry. */
  onPatch: (patch: Partial<PhotoFill>, coalesce?: string) => void
  onImportPhoto: (file: File) => Promise<Photo | null>
}) {
  const library = usePhotoLibrary()
  const prefs = usePhotoPrefs()
  const loaded = usePhotos()
  const meta = library.byId.get(fill.photoId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const inPool = photoPool.photos.some((p) => p.photoId === fill.photoId)

  // Pool photos first, then uploads — the full library is thousands deep and
  // lives in the Photos section's browser, not in a dropdown.
  const seen = new Set<string>()
  const options: { value: string; label: string }[] = []
  const add = (id: string, label: string) => {
    if (seen.has(id)) return
    seen.add(id)
    options.push({ value: id, label })
  }
  for (const p of photoPool.photos) add(p.photoId, `${library.byId.get(p.photoId)?.name ?? 'Missing photo'} · pool`)
  for (const m of library.list) if (m.origin === 'upload') add(m.id, m.name)
  if (fill.photoId) add(fill.photoId, meta?.name ?? 'Missing photo')
  if (!fill.photoId) options.unshift({ value: '', label: 'No photo yet' })

  return (
    <>
      <Select
        label="Photo"
        value={fill.photoId}
        options={options}
        tools={
          <button
            type="button"
            className="btn btn--tiny"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Adding…' : 'Upload'}
          </button>
        }
        onChange={(photoId) => {
          onPatch({ photoId, ...framingFor(library.byId.get(photoId), prefs.prefs, photoId) })
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="offstage"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          const added = await onImportPhoto(file)
          setBusy(false)
          // A new photo starts centered and unzoomed.
          if (added) onPatch({ photoId: added.id, zoom: 1, focusX: 0.5, focusY: 0.5 })
        }}
      />
      {fill.photoId && (
        <div className="chiprow">
          <ConstraintChip
            label="In photo pool"
            on={inPool}
            title="Remix and Batch fill segments with photos from the pool (Photos section), each framed as set — this one included. Framing edits here update it everywhere. Lock this cell's fill instead to pin this photo to this exact cell."
            onToggle={onPool}
          />
        </div>
      )}
      {meta ? (
        <Field label="Focal point" hint={loaded.has(fill.photoId) ? undefined : 'loading…'}>
          <FocalPointPicker
            src={meta.thumbUrl}
            width={meta.width}
            height={meta.height}
            focusX={fill.focusX}
            focusY={fill.focusY}
            onChange={(focusX, focusY) => onPatch({ focusX, focusY }, 'photo-focus')}
          />
        </Field>
      ) : (
        <div className="note">
          {fill.photoId
            ? 'This photo is not in this browser’s library — upload it again or pick another.'
            : 'Upload a photo, or add some to the pool in the Photos section.'}
        </div>
      )}
      <Slider
        label="Zoom"
        value={fill.zoom}
        min={1}
        max={4}
        tools={
          <AdvLock
            on={!!fill.locks?.scale}
            title="Lock the zoom against remix."
            onToggle={(on) => onPatch({ locks: { ...fill.locks, scale: on } })}
          />
        }
        onChange={(zoom) => onPatch({ zoom }, 'photo-zoom')}
      />
      <Adv>
        <Slider
          label="Focus X"
          value={fill.focusX}
          min={0}
          max={1}
          onChange={(focusX) => onPatch({ focusX }, 'photo-focus')}
        />
        <Slider
          label="Focus Y"
          value={fill.focusY}
          min={0}
          max={1}
          onChange={(focusY) => onPatch({ focusY }, 'photo-focus')}
        />
      </Adv>
    </>
  )
}

/* ---------- pattern layer mask ---------- */

function MaskControls({
  mask,
  onPatch,
}: {
  mask: LayerMask
  onPatch: (patch: Partial<LayerMask>, coalesce?: string) => void
}) {
  return (
    <>
      <Segmented
        label="Paint region"
        value={mask.mode}
        options={MASK_OPTIONS}
        onChange={(mode) => onPatch({ mode })}
      />
      {mask.mode !== 'orb' && (
        <>
          <div className="grid2">
            <Slider
              label="Lens X"
              value={mask.cx}
              min={-1}
              max={1}
              onChange={(cx) => onPatch({ cx }, 'mk-cx')}
            />
            <Slider
              label="Lens Y"
              value={mask.cy}
              min={-1}
              max={1}
              onChange={(cy) => onPatch({ cy }, 'mk-cy')}
            />
          </div>
          <Slider
            label="Lens radius"
            value={mask.radius}
            min={0.05}
            max={2}
            onChange={(radius) => onPatch({ radius }, 'mk-r')}
          />
          <Slider
            label="Edge feather"
            value={mask.feather}
            min={0}
            max={1}
            onChange={(feather) => onPatch({ feather }, 'mk-f')}
          />
        </>
      )}
    </>
  )
}

/* ---------- fill editing (color panel + pattern base) ---------- */

/** Every stop the same color ⇒ the gradient renders as a flat ink. */
function isFlatFill(g: Gradient): boolean {
  const first = g.stops[0]?.color
  if (!first) return false
  return g.stops.every(
    (s) => s.color.slot === first.slot && (s.color.hex ?? null) === (first.hex ?? null),
  )
}

/**
 * The base fill: FLAT edits one ink written as a two-stop constant gradient
 * (no second render path to maintain); GRADIENT is the full editor, tiered.
 */
function FillEditor({
  label,
  gradient,
  palette,
  onChange,
}: {
  label: string
  gradient: Gradient
  palette: Palette
  onChange: (g: Gradient, coalesce?: string) => void
}) {
  const flat = isFlatFill(gradient)
  return (
    <>
      <Segmented
        label={label}
        value={flat ? 'flat' : 'gradient'}
        options={[
          { value: 'flat', label: 'flat color' },
          { value: 'gradient', label: 'gradient' },
        ]}
        onChange={(v) => {
          if (v === (flat ? 'flat' : 'gradient')) return
          if (v === 'flat') {
            const ink = gradient.stops[0]?.color ?? { slot: 4 }
            onChange({
              ...gradient,
              type: 'linear',
              stops: [
                { id: nextId('s'), offset: 0, color: { ...ink } },
                { id: nextId('s'), offset: 1, color: { ...ink } },
              ],
            })
          } else {
            const from = gradient.stops[0]?.color ?? { slot: 2 }
            onChange({
              ...gradient,
              stops: [
                { id: nextId('s'), offset: 0, color: { ...from } },
                {
                  id: nextId('s'),
                  offset: 1,
                  color: { slot: Math.max(0, palette.colors.length - 1) },
                },
              ],
            })
          }
        }}
      />
      {flat ? (
        <ColorRefEditor
          name="Ink"
          value={gradient.stops[0].color}
          palette={palette}
          showAlpha={false}
          onChange={(color) =>
            onChange({
              ...gradient,
              stops: gradient.stops.map((s) => ({ ...s, color: { ...color } })),
            })
          }
        />
      ) : (
        <>
          <BrandGradientStrip
            active={activeBrandId(gradient)}
            onPick={(g) => onChange(brandGradientFor(g, palette, gradient))}
          />
          <GradientEditor gradient={gradient} palette={palette} onChange={onChange} />
        </>
      )}
    </>
  )
}

/* ---------- 01 Orb ---------- */

function OrbSection(props: SidebarProps) {
  const { doc, palette, parsedById, open, onToggleSection, update, onRandomizeSection } = props
  const [more, setMore] = useState(false)

  const patchOrb = (patch: Partial<OrbDoc['orb']>, coalesce?: string) =>
    update((d) => ({ ...d, orb: { ...d.orb, ...patch } }), coalesce)

  const sub = doc.subLocks.orb
  const setSub = (key: keyof typeof sub) => (on: boolean) =>
    update((d) => ({
      ...d,
      subLocks: { ...d.subLocks, orb: { ...d.subLocks.orb, [key]: on } },
    }))
  // Existence implication: any locked cell pins the structure.
  const cellsLocked =
    [...doc.orb.sectors.rowA, ...doc.orb.sectors.rowB].filter(anyLock).length
  const activeSubs = (['type', 'size', 'position', 'structure'] as const).filter((k) => sub[k])
  const partial = activeSubs.length + cellsLocked
  const partialTitle =
    `Remix may change the orb except: ${[
      ...activeSubs,
      ...(cellsLocked > 0 ? [`${cellsLocked} locked segment${cellsLocked === 1 ? '' : 's'} (structure pinned)`] : []),
    ].join(', ')}. Colors still follow the palette.`

  const typeHint = ORB_TYPE_LABELS[doc.orbType].toLowerCase()

  return (
    <Section
      num="01"
      title="Orb"
      hint={doc.orb.visible ? typeHint : `${typeHint} · hidden`}
      open={open.orb}
      onToggle={() => onToggleSection('orb')}
      lock={{
        section: 'orb',
        on: doc.locks.orb,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, orb: on } })),
        partial,
        partialTitle,
      }}
      randomize={{
        label: 'Randomize the orb only',
        onRandomize: () => onRandomizeSection('orb'),
        disabled: doc.locks.orb,
      }}
      more={{ on: more, onToggle: setMore }}
    >
      <Segmented
        label="Type"
        value={doc.orbType}
        options={ORB_TYPES.map((t) => ({ value: t, label: ORB_TYPE_LABELS[t] }))}
        tools={
          <PropLock
            on={sub.type}
            implied={doc.locks.orb}
            title="Lock the type: remix keeps it (a segments orb stays segments, cells still re-deal)."
            onToggle={setSub('type')}
          />
        }
        onChange={(t) => props.onSetOrbType(t)}
      />
      <Slider
        label="Size"
        value={doc.orb.radius}
        min={0.05}
        max={1.4}
        tools={
          <PropLock
            on={sub.size}
            implied={doc.locks.orb}
            title="Lock the size: remix keeps this radius."
            onToggle={setSub('size')}
          />
        }
        onChange={(radius) => patchOrb({ radius }, 'orb-r')}
      />
      <div className="chiprow">
        <ConstraintChip
          label="Hide orb"
          on={!doc.orb.visible}
          title="Hide the orb entirely — background, accents and canvas remain."
          onToggle={(on) => patchOrb({ visible: !on })}
        />
        <ConstraintChip
          label="Flat"
          on={doc.flat}
          title="Suppresses shading and the crescent rim light at render time. Gradients, patterns, rings, satellites and the vignette stay. Settings are kept, so turning it off restores them."
          onToggle={(flat) => update((d) => ({ ...d, flat }))}
        />
        <ConstraintChip
          label="Solid fills"
          on={doc.solidFills}
          title="Renders every smooth gradient as a flat ink sampled from its own ramp: the disc fill, the background, sector ramps and the vignette. Gradient settings are kept, so turning it off restores them."
          onToggle={(solidFills) => update((d) => ({ ...d, solidFills }))}
        />
      </div>
      <Adv>
        <Slider
          label="Center X"
          value={doc.orb.cx}
          min={-0.5}
          max={1.5}
          tools={
            // One glyph guards the pair — two fields, one user idea.
            <PropLock
              on={sub.position}
              implied={doc.locks.orb}
              title="Lock the position: remix keeps center X and Y together."
              onToggle={setSub('position')}
            />
          }
          onChange={(cx) => patchOrb({ cx }, 'orb-cx')}
        />
        <Slider
          label="Center Y"
          value={doc.orb.cy}
          min={-0.5}
          max={1.5}
          onChange={(cy) => patchOrb({ cy }, 'orb-cy')}
        />
      </Adv>
      <hr className="divider" />

      {/* Mode-dependent panel: only what the chosen type can use. */}
      {doc.orbType === 'color' && (
        <FillEditor
          label="Fill"
          gradient={doc.orb.gradient}
          palette={palette}
          onChange={(gradient, coalesce) => patchOrb({ gradient }, coalesce)}
        />
      )}

      {doc.orbType === 'pattern' && <PatternPanel {...props} />}

      {doc.orbType === 'segments' && (
        <>
          <div className="eyebrow">Structure</div>
          <Slider
            label="Split angle"
            value={doc.orb.sectors.angle}
            min={0}
            max={360}
            step={1}
            suffix="°"
            tools={
              <PropLock
                on={sub.structure}
                implied={doc.locks.orb || cellsLocked > 0}
                title={
                  cellsLocked > 0 && !sub.structure
                    ? `Structure pinned — ${cellsLocked} segment${cellsLocked === 1 ? ' has' : 's have'} locked properties. Click to pin it in its own right.`
                    : 'Lock the structure: remix keeps the chord and both cell counts, and keeps dealing what is inside them.'
                }
                onToggle={setSub('structure')}
              />
            }
            onChange={(angle) =>
              update(
                (d) => ({ ...d, orb: { ...d.orb, sectors: { ...d.orb.sectors, angle } } }),
                'sec-angle',
              )
            }
          />
          <Adv>
            <Slider
              label="Split offset"
              value={doc.orb.sectors.offset}
              min={-0.9}
              max={0.9}
              onChange={(offset) =>
                update(
                  (d) => ({ ...d, orb: { ...d.orb, sectors: { ...d.orb.sectors, offset } } }),
                  'sec-offset',
                )
              }
            />
          </Adv>
          <SectorRowEditor
            rowKey="rowA"
            label="Row A"
            row={doc.orb.sectors.rowA}
            palette={palette}
            parsedById={parsedById}
            patternOptions={props.patternOptions}
            onSetTexture={props.onSetSectorTexture}
            onImportPhoto={props.onImportPhoto}
            photoPool={doc.photoPool}
            updateDoc={update}
            onChange={(rowA, coalesce) =>
              update((d) => ({ ...d, orb: { ...d.orb, sectors: { ...d.orb.sectors, rowA } } }), coalesce)
            }
          />
          <hr className="divider" />
          <SectorRowEditor
            rowKey="rowB"
            label="Row B"
            row={doc.orb.sectors.rowB}
            palette={palette}
            parsedById={parsedById}
            patternOptions={props.patternOptions}
            onSetTexture={props.onSetSectorTexture}
            onImportPhoto={props.onImportPhoto}
            photoPool={doc.photoPool}
            updateDoc={update}
            onChange={(rowB, coalesce) =>
              update((d) => ({ ...d, orb: { ...d.orb, sectors: { ...d.orb.sectors, rowB } } }), coalesce)
            }
          />
        </>
      )}

      <Adv>
        <hr className="divider" />
        <Check
          label="Outline"
          checked={doc.orb.stroke.enabled}
          onChange={(enabled) => patchOrb({ stroke: { ...doc.orb.stroke, enabled } })}
        />
        {doc.orb.stroke.enabled && (
          <>
            <Slider
              label="Outline width"
              value={doc.orb.stroke.width}
              min={0.2}
              max={40}
              step={0.2}
              decimals={1}
              onChange={(width) => patchOrb({ stroke: { ...doc.orb.stroke, width } }, 'orb-sw')}
            />
            <Slider
              label="Outline opacity"
              value={doc.orb.stroke.opacity}
              min={0}
              max={1}
              onChange={(opacity) =>
                patchOrb({ stroke: { ...doc.orb.stroke, opacity } }, 'orb-so')
              }
            />
            <ColorRefEditor
              name="Outline color"
              value={doc.orb.stroke.color}
              palette={palette}
              showAlpha={false}
              onChange={(color) => patchOrb({ stroke: { ...doc.orb.stroke, color } })}
            />
          </>
        )}
        <ShadingBlock {...props} />
        <StackBlock {...props} />
      </Adv>
    </Section>
  )
}

/* ---------- the Pattern type panel ---------- */

function PatternPanel(props: SidebarProps) {
  const { doc, palette, parsedById, update } = props
  const patternLayers = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
  const visible = patternLayers.filter((l) => l.visible)
  const [addId, setAddId] = useState(props.patternOptions[0]?.id ?? '')
  const parentAdvanced = useTier() === 'advanced'
  const [moreLayers, setMoreLayers] = useState<Record<string, boolean>>({})

  const patch = (id: string, recipe: (l: PatternLayer) => PatternLayer, coalesce?: string) =>
    update(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === id && l.kind === 'pattern' ? recipe(l) : l)),
      }),
      coalesce,
    )

  return (
    <>
      <div className="eyebrow">Base</div>
      <FillEditor
        label="Base fill"
        gradient={doc.orb.gradient}
        palette={palette}
        onChange={(gradient, coalesce) =>
          update((d) => ({ ...d, orb: { ...d.orb, gradient } }), coalesce)
        }
      />
      <hr className="divider" />
      <div className="eyebrow">
        Layers · {visible.length} of {patternLayers.length}
        <span className="eyebrow__tools">
          {/* The patterns *section* lock lives here — its section is the panel. */}
          <button
            type="button"
            className={`lock lock--mini${doc.locks.patterns ? ' lock--on' : ''}`}
            title={
              doc.locks.patterns
                ? 'Locked — the pattern layers are frozen wholesale, including for Remix. Colors still follow the palette.'
                : 'Freeze all pattern layers against Remix.'
            }
            aria-pressed={doc.locks.patterns}
            onClick={() =>
              update((d) => ({ ...d, locks: { ...d.locks, patterns: !d.locks.patterns } }))
            }
          >
            {doc.locks.patterns ? 'LOCKED' : 'LOCK'}
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={doc.locks.patterns}
            onClick={() => props.onRandomizeSection('patterns')}
          >
            randomize
          </button>
        </span>
      </div>
      <Check
        label={`Lock layer count for remix (${patternLayers.length})`}
        checked={doc.subLocks.patterns.count}
        onChange={(count) =>
          update((d) => ({
            ...d,
            subLocks: { ...d.subLocks, patterns: { ...d.subLocks.patterns, count } },
          }))
        }
      />
      {patternLayers.some(anyLock) && !doc.subLocks.patterns.count && (
        <div className="note">
          A locked layer pins the layer count for remix — the locked thing must keep existing.
        </div>
      )}
      {patternLayers.map((layer, i) => (
        <Scope key={layer.id} advanced={parentAdvanced || !!moreLayers[layer.id]}>
        <div className="layercard">
          <div className="layercard__head">
            <button
              type="button"
              className="layer__mini"
              title={layer.visible ? 'Hide layer' : 'Show layer'}
              onClick={() => patch(layer.id, (l) => ({ ...l, visible: !l.visible }))}
            >
              {layer.visible ? '●' : '○'}
            </button>
            <span className="layercard__title">Layer {i + 1}</span>
            <span className="layercard__hint">{layer.name}</span>
            <MoreToggle
              on={parentAdvanced || !!moreLayers[layer.id]}
              what={`layer ${i + 1}`}
              onToggle={(on) => setMoreLayers((m) => ({ ...m, [layer.id]: on }))}
            />
            <ObjectLockChip
              locks={layer.locks}
              vocabulary={LAYER_PROPS}
              what="layer"
              onChange={(locks) => patch(layer.id, (l) => ({ ...l, locks }))}
            />
          </div>
          {layer.visible && (
            <PatternLayerEditor
              layer={layer}
              palette={palette}
              parsed={parsedById.get(layer.patternId)}
              patternOptions={props.patternOptions}
              onSetPattern={(patternId) => props.onSetLayerPattern(layer.id, patternId)}
              onPatch={(recipe, coalesce) => patch(layer.id, recipe, coalesce)}
              onRevealAdvanced={() => setMoreLayers((m) => ({ ...m, [layer.id]: true }))}
            />
          )}
        </div>
        </Scope>
      ))}
      {visible.length < 2 && (
        <Field label="Add pattern layer">
          <div className="field__row">
            <select
              className="select"
              value={addId}
              aria-label="Pattern to add"
              onChange={(e) => setAddId(e.target.value)}
            >
              {props.patternOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.imported ? `${p.name} (imported)` : p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => addId && props.onAddPatternLayer(addId)}
            >
              Add
            </button>
          </div>
        </Field>
      )}
      <div className="note">
        Drop <strong>.svg</strong> files anywhere to add your own patterns — they run through the
        same fill extraction and palette-slot mapping as the built-ins, and become available to
        Remix.
      </div>
    </>
  )
}

function PatternLayerEditor({
  layer,
  palette,
  parsed,
  patternOptions,
  onSetPattern,
  onPatch,
  onRevealAdvanced,
}: {
  layer: PatternLayer
  palette: Palette
  parsed: ParsedPattern | undefined
  patternOptions: SidebarProps['patternOptions']
  onSetPattern: (patternId: string) => void
  onPatch: (recipe: (l: PatternLayer) => PatternLayer, coalesce?: string) => void
  /** Opens this card's advanced scope — the passive state tags route here. */
  onRevealAdvanced?: () => void
}) {
  const tier = useTier()
  const setLock = (key: LayerPropertyLock) => (on: boolean) =>
    onPatch((l) => ({ ...l, locks: { ...l.locks, [key]: on } }))
  const k = layer.locks ?? {}
  return (
    <>
      <Select
        label="Pattern"
        value={layer.patternId}
        options={withCurrent(patternOptions, layer.patternId, parsed?.name ?? layer.name).map((p) => ({
          value: p.id,
          label: p.imported ? `${p.name} (imported)` : p.name,
        }))}
        tools={
          <AdvLock
            on={!!k.pattern}
            title="Lock the pattern: remix keeps this texture, everything else on the layer stays remixable."
            onToggle={setLock('pattern')}
          />
        }
        onChange={onSetPattern}
      />
      <Slider
        label="Scale"
        value={layer.scale}
        min={0.05}
        max={4}
        tools={
          <AdvLock
            on={!!k.scale}
            title="Lock the scale against remix."
            onToggle={setLock('scale')}
          />
        }
        onChange={(scale) => onPatch((l) => ({ ...l, scale }), `pat-s-${layer.id}`)}
      />
      <Slider
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        onChange={(opacity) => onPatch((l) => ({ ...l, opacity }), `pat-op-${layer.id}`)}
      />
      {/* Passive state tags: hidden advanced state that changes pixels must
          never be invisible — and tapping one opens the controls that own it. */}
      {tier !== 'advanced' && (layer.blend !== 'normal' || layer.mask.mode !== 'orb') && (
        <button
          type="button"
          className="note note--link"
          title="Open this layer's advanced settings"
          onClick={onRevealAdvanced}
        >
          {layer.blend !== 'normal' ? `blend: ${layer.blend}` : ''}
          {layer.blend !== 'normal' && layer.mask.mode !== 'orb' ? ' · ' : ''}
          {layer.mask.mode !== 'orb'
            ? `mask: ${layer.mask.mode}${layer.mask.feather > 0 ? ` · feather ${layer.mask.feather.toFixed(2)}` : ''}`
            : ''}
          {' →'}
        </button>
      )}
      <Adv>
        <TextField
          label="Layer name"
          value={layer.name}
          mono={false}
          onCommit={(name) => onPatch((l) => ({ ...l, name }))}
        />
        <Segmented
          label="Fit"
          value={layer.fit}
          options={[
            { value: 'tile', label: 'tile' },
            { value: 'cover', label: 'cover' },
          ]}
          onChange={(fit) => onPatch((l) => ({ ...l, fit }))}
        />
        <Slider
          label="Rotation"
          value={layer.rotation}
          min={-180}
          max={180}
          step={1}
          suffix="°"
          tools={
            <AdvLock
              on={!!k.rotation}
              title="Lock the rotation against remix."
              onToggle={setLock('rotation')}
            />
          }
          onChange={(rotation) => onPatch((l) => ({ ...l, rotation }), `pat-rot-${layer.id}`)}
        />
        <Slider
          label="Offset X"
          value={layer.offsetX}
          min={-1}
          max={1}
          tools={
            <AdvLock
              on={!!k.position}
              title="Lock the position: remix keeps offset X and Y together."
              onToggle={setLock('position')}
            />
          }
          onChange={(offsetX) => onPatch((l) => ({ ...l, offsetX }), `pat-ox-${layer.id}`)}
        />
        <Slider
          label="Offset Y"
          value={layer.offsetY}
          min={-1}
          max={1}
          onChange={(offsetY) => onPatch((l) => ({ ...l, offsetY }), `pat-oy-${layer.id}`)}
        />
        <Select
          label="Blend mode"
          value={layer.blend}
          options={BLEND_OPTIONS}
          onChange={(blend) => onPatch((l) => ({ ...l, blend }))}
        />
        <div className="eyebrow">Overlap region</div>
        <MaskControls
          mask={layer.mask ?? DEFAULT_LAYER_MASK}
          onPatch={(patch, coalesce) =>
            onPatch(
              (l) => ({ ...l, mask: { ...(l.mask ?? DEFAULT_LAYER_MASK), ...patch } }),
              coalesce,
            )
          }
        />
      </Adv>
      <div className="eyebrow">
        Inks
        <span className="eyebrow__tools">
          <AdvLock
            on={!!k.color}
            title="Lock the inks: remix keeps this layer's palette-slot assignments. Switching palettes still recolors — freeze that with the Palette lock."
            onToggle={setLock('color')}
          />
        </span>
      </div>
      {!parsed && <div className="note">Loading pattern…</div>}
      {parsed?.groups.map((group) => (
        <ColorRefEditor
          key={group.index}
          name={group.label}
          chip={group.sample}
          value={layer.colors[group.index] ?? { slot: 0, alpha: group.isBackground ? 0 : 1 }}
          palette={palette}
          onChange={(color) =>
            onPatch((l) => {
              const colors = l.colors.slice()
              while (colors.length <= group.index) colors.push({ slot: 0, alpha: 1 })
              colors[group.index] = color
              return { ...l, colors }
            })
          }
        />
      ))}
    </>
  )
}

/* ---------- Advanced blocks inside Orb: shading + the raw stack ---------- */

function ShadingBlock({ doc, palette, update, onRandomizeSection }: SidebarProps) {
  const layer = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const patch = (recipe: (l: ShadingLayer) => ShadingLayer, coalesce?: string) => {
    if (!layer) return
    update(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? recipe(l as ShadingLayer) : l)),
      }),
      coalesce,
    )
  }
  return (
    <>
      <hr className="divider" />
      <div className="eyebrow">
        Shading
        <span className="eyebrow__tools">
          <button
            type="button"
            className={`lock lock--mini${doc.locks.shading ? ' lock--on' : ''}`}
            title="Freeze the shading against Remix"
            aria-pressed={doc.locks.shading}
            onClick={() =>
              update((d) => ({ ...d, locks: { ...d.locks, shading: !d.locks.shading } }))
            }
          >
            {doc.locks.shading ? 'LOCKED' : 'LOCK'}
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={doc.locks.shading || !layer}
            onClick={() => onRandomizeSection('shading')}
          >
            randomize
          </button>
        </span>
      </div>
      {!layer ? (
        <div className="note">No shading layer. Add one from the Stack below.</div>
      ) : (
        <>
          {doc.flat && <div className="note">Flat mode — shading suppressed.</div>}
          <Inert disabled={doc.flat}>
            <Check
              label="Visible"
              checked={layer.visible}
              onChange={(visible) => patch((l) => ({ ...l, visible }))}
            />
            {layer.visible && <ShadingControls layer={layer} palette={palette} onPatch={patch} />}
          </Inert>
        </>
      )}
    </>
  )
}

const LAYER_KIND_LABEL: Record<Layer['kind'], string> = {
  pattern: 'PAT',
  shading: 'SHD',
  accent: 'ACC',
}

/**
 * The raw reorderable stack — the implementation view, Advanced only. The
 * friendly editing surfaces live in the type panels and the Accents section;
 * this is where reorder, duplicate, delete, and the + Shading / + Accents
 * additive acts live.
 */
function StackBlock({ doc, update, onAddPatternLayer, patternOptions }: SidebarProps) {
  const [patternId, setPatternId] = useState(patternOptions[0]?.id ?? '')

  const move = (index: number, delta: number) =>
    update((d) => {
      const to = index + delta
      if (to < 0 || to >= d.layers.length) return d
      const layers = d.layers.slice()
      const [moved] = layers.splice(index, 1)
      layers.splice(to, 0, moved)
      return { ...d, layers }
    })

  const duplicate = (index: number) =>
    update((d) => {
      const src = d.layers[index]
      const copy: Layer = structuredClone(src)
      copy.id = nextId(src.kind === 'pattern' ? 'pl' : src.kind === 'shading' ? 'sh' : 'ac')
      copy.name = `${src.name} copy`
      if (copy.kind === 'accent') {
        copy.rings = copy.rings.map((r) => ({ ...r, id: nextId('r') }))
        copy.satellites = copy.satellites.map((s) => ({ ...s, id: nextId('sa') }))
      }
      // Duplicating a locked layer copies its property locks — a user
      // duplicating "the good one" wants the lock to travel with it.
      const layers = d.layers.slice()
      layers.splice(index + 1, 0, copy)
      return { ...d, layers }
    })

  const remove = (id: string) =>
    update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }))

  const addShading = () =>
    update((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          kind: 'shading',
          id: nextId('sh'),
          name: 'Sphere shading',
          visible: true,
          shadow: 0.8,
          highlight: 0.4,
          lightAngle: 315,
          lightDistance: 0.5,
          highlightSize: 0.95,
          contactShadow: 0.4,
          shadowColor: { slot: 0 },
          highlightColor: { slot: Math.max(0, d.layers.length) },
          blend: 'normal',
          opacity: 1,
        } satisfies ShadingLayer,
      ],
    }))

  const addAccent = () =>
    update((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          kind: 'accent',
          id: nextId('ac'),
          name: 'Accents',
          visible: true,
          rings: [
            {
              id: nextId('r'),
              radius: 1.25,
              start: 200,
              sweep: 230,
              width: 2.5,
              color: { slot: 3 },
              opacity: 0.6,
              tilt: 0.35,
              rotation: -18,
              dash: 0,
            },
          ],
          satellites: [],
          rim: {
            enabled: false,
            angle: 315,
            width: 0.045,
            spread: 0.55,
            color: { slot: 7 },
            opacity: 0.7,
            blend: 'screen',
          },
        } satisfies AccentLayer,
      ],
    }))

  return (
    <>
      <hr className="divider" />
      <div className="eyebrow">Stack · painted bottom → top</div>
      <div className="layers">
        {doc.layers.map((layer, i) => (
          <div key={layer.id} className="layer">
            <div className="layer__row">
              <button
                type="button"
                className="layer__mini"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    layers: d.layers.map((l) =>
                      l.id === layer.id ? { ...l, visible: !l.visible } : l,
                    ),
                  }))
                }
              >
                {layer.visible ? '●' : '○'}
              </button>
              <span className="layer__kind">{LAYER_KIND_LABEL[layer.kind]}</span>
              <span className="layer__name">{layer.name}</span>
              <button type="button" className="layer__mini" onClick={() => move(i, -1)} disabled={i === 0} title="Move down the stack">
                ↓
              </button>
              <button type="button" className="layer__mini" onClick={() => move(i, 1)} disabled={i === doc.layers.length - 1} title="Move up the stack">
                ↑
              </button>
              <button type="button" className="layer__mini" onClick={() => duplicate(i)} title="Duplicate layer">
                ⧉
              </button>
              <button type="button" className="layer__mini" onClick={() => remove(layer.id)} title="Delete layer">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <Field label="Add pattern layer">
        <div className="field__row">
          <select
            className="select"
            value={patternId}
            aria-label="Pattern to add"
            onChange={(e) => setPatternId(e.target.value)}
          >
            {patternOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.imported ? `${p.name} (imported)` : p.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => patternId && onAddPatternLayer(patternId)}>
            Add
          </button>
        </div>
      </Field>
      <div className="row">
        <button type="button" className="btn" onClick={addShading}>
          + Shading
        </button>
        <button type="button" className="btn" onClick={addAccent}>
          + Accents
        </button>
      </div>
      <div className="note">
        Pattern layers are clipped to the orb circle; accents are not, so moving one below the
        patterns puts a ring behind the orb.
      </div>
    </>
  )
}

/* ---------- shading controls (single home) ---------- */

function ShadingControls({
  layer,
  palette,
  onPatch,
}: {
  layer: ShadingLayer
  palette: Palette
  onPatch: (recipe: (l: ShadingLayer) => ShadingLayer, coalesce?: string) => void
}) {
  return (
    <>
      <Slider
        label="Light angle"
        value={layer.lightAngle}
        min={0}
        max={360}
        step={1}
        suffix="°"
        onChange={(lightAngle) => onPatch((l) => ({ ...l, lightAngle }), `sh-a-${layer.id}`)}
      />
      <Slider
        label="Terminator shadow"
        value={layer.shadow}
        min={0}
        max={1}
        onChange={(shadow) => onPatch((l) => ({ ...l, shadow }), `sh-s-${layer.id}`)}
      />
      <Slider
        label="Highlight"
        value={layer.highlight}
        min={0}
        max={1}
        onChange={(highlight) => onPatch((l) => ({ ...l, highlight }), `sh-h-${layer.id}`)}
      />
      <Slider
        label="Highlight size"
        value={layer.highlightSize}
        min={0.1}
        max={2}
        onChange={(highlightSize) => onPatch((l) => ({ ...l, highlightSize }), `sh-hs-${layer.id}`)}
      />
      <Slider
        label="Light distance"
        value={layer.lightDistance}
        min={0}
        max={1.2}
        onChange={(lightDistance) =>
          onPatch((l) => ({ ...l, lightDistance }), `sh-ld-${layer.id}`)
        }
      />
      <Slider
        label="Contact shadow"
        value={layer.contactShadow}
        min={0}
        max={1}
        onChange={(contactShadow) => onPatch((l) => ({ ...l, contactShadow }), `sh-cs-${layer.id}`)}
      />
      <Slider
        label="Layer opacity"
        value={layer.opacity}
        min={0}
        max={1}
        onChange={(opacity) => onPatch((l) => ({ ...l, opacity }), `sh-op-${layer.id}`)}
      />
      <Select
        label="Blend mode"
        value={layer.blend}
        options={BLEND_OPTIONS}
        onChange={(blend) => onPatch((l) => ({ ...l, blend }))}
      />
      <ColorRefEditor
        name="Shadow color"
        value={layer.shadowColor}
        palette={palette}
        showAlpha={false}
        onChange={(shadowColor) => onPatch((l) => ({ ...l, shadowColor }))}
      />
      <ColorRefEditor
        name="Highlight color"
        value={layer.highlightColor}
        palette={palette}
        showAlpha={false}
        onChange={(highlightColor) => onPatch((l) => ({ ...l, highlightColor }))}
      />
    </>
  )
}

/* ---------- 03 Accents ---------- */

function AccentControls({
  layer,
  palette,
  onPatch,
  suppressRim,
}: {
  layer: AccentLayer
  palette: Palette
  onPatch: (recipe: (l: AccentLayer) => AccentLayer, coalesce?: string) => void
  /** Flat mode: the rim light does not render, so its controls are inert. */
  suppressRim: boolean
}) {
  const patchRing = (id: string, patch: Partial<AccentLayer['rings'][number]>, coalesce?: string) =>
    onPatch(
      (l) => ({ ...l, rings: l.rings.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
      coalesce,
    )
  const patchSat = (
    id: string,
    patch: Partial<AccentLayer['satellites'][number]>,
    coalesce?: string,
  ) =>
    onPatch(
      (l) => ({
        ...l,
        satellites: l.satellites.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }),
      coalesce,
    )

  return (
    <>
      <div className="eyebrow">Orbital rings</div>
      {layer.rings.map((ring, i) => (
        <div key={ring.id} className="colorref">
          <div className="colorref__head">
            <span className="colorref__name">Ring {i + 1}</span>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => onPatch((l) => ({ ...l, rings: l.rings.filter((r) => r.id !== ring.id) }))}
            >
              remove
            </button>
          </div>
          <Slider
            label="Radius"
            value={ring.radius}
            min={0.2}
            max={2.5}
            onChange={(radius) => patchRing(ring.id, { radius }, `ring-r-${ring.id}`)}
          />
          <Slider
            label="Stroke width"
            value={ring.width}
            min={0.2}
            max={60}
            step={0.2}
            decimals={1}
            onChange={(width) => patchRing(ring.id, { width }, `ring-w-${ring.id}`)}
          />
          <ColorRefEditor
            name="Ring color"
            value={ring.color}
            palette={palette}
            showAlpha={false}
            onChange={(color) => patchRing(ring.id, { color })}
          />
          <Adv>
            <Slider
              label="Tilt"
              value={ring.tilt}
              min={0.02}
              max={1}
              onChange={(tilt) => patchRing(ring.id, { tilt }, `ring-t-${ring.id}`)}
            />
            <Slider
              label="Ellipse rotation"
              value={ring.rotation}
              min={-90}
              max={90}
              step={1}
              suffix="°"
              onChange={(rotation) => patchRing(ring.id, { rotation }, `ring-rot-${ring.id}`)}
            />
            <div className="grid2">
              <Slider
                label="Arc start"
                value={ring.start}
                min={0}
                max={360}
                step={1}
                suffix="°"
                onChange={(start) => patchRing(ring.id, { start }, `ring-st-${ring.id}`)}
              />
              <Slider
                label="Arc sweep"
                value={ring.sweep}
                min={-359}
                max={359}
                step={1}
                suffix="°"
                onChange={(sweep) => patchRing(ring.id, { sweep }, `ring-sw-${ring.id}`)}
              />
            </div>
            <Slider
              label="Dash"
              value={ring.dash}
              min={0}
              max={60}
              step={0.5}
              decimals={1}
              onChange={(dash) => patchRing(ring.id, { dash }, `ring-d-${ring.id}`)}
            />
            <Slider
              label="Opacity"
              value={ring.opacity}
              min={0}
              max={1}
              onChange={(opacity) => patchRing(ring.id, { opacity }, `ring-o-${ring.id}`)}
            />
          </Adv>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--block"
        onClick={() =>
          onPatch((l) => ({
            ...l,
            rings: [
              ...l.rings,
              {
                id: nextId('r'),
                radius: 1.2,
                start: 0,
                sweep: 300,
                width: 2,
                color: { slot: 5 },
                opacity: 0.6,
                tilt: 0.4,
                rotation: 0,
                dash: 0,
              },
            ],
          }))
        }
      >
        + Ring
      </button>

      <hr className="divider" />
      <div className="eyebrow">Satellites</div>
      {layer.satellites.map((sat, i) => (
        <div key={sat.id} className="colorref">
          <div className="colorref__head">
            <span className="colorref__name">Satellite {i + 1}</span>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() =>
                onPatch((l) => ({ ...l, satellites: l.satellites.filter((s) => s.id !== sat.id) }))
              }
            >
              remove
            </button>
          </div>
          <Slider
            label="Angle"
            value={sat.angle}
            min={0}
            max={360}
            step={1}
            suffix="°"
            onChange={(angle) => patchSat(sat.id, { angle }, `sat-a-${sat.id}`)}
          />
          <Slider
            label="Size"
            value={sat.size}
            min={0.005}
            max={0.5}
            onChange={(size) => patchSat(sat.id, { size }, `sat-s-${sat.id}`)}
          />
          <ColorRefEditor
            name="Satellite color"
            value={sat.color}
            palette={palette}
            showAlpha={false}
            onChange={(color) => patchSat(sat.id, { color })}
          />
          <Adv>
            <Slider
              label="Distance"
              value={sat.distance}
              min={0}
              max={3}
              onChange={(distance) => patchSat(sat.id, { distance }, `sat-d-${sat.id}`)}
            />
            <Slider
              label="Ring stroke (0 = filled)"
              value={sat.strokeWidth}
              min={0}
              max={20}
              step={0.5}
              decimals={1}
              onChange={(strokeWidth) => patchSat(sat.id, { strokeWidth }, `sat-sw-${sat.id}`)}
            />
            <Slider
              label="Opacity"
              value={sat.opacity}
              min={0}
              max={1}
              onChange={(opacity) => patchSat(sat.id, { opacity }, `sat-o-${sat.id}`)}
          />
          </Adv>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--block"
        onClick={() =>
          onPatch((l) => ({
            ...l,
            satellites: [
              ...l.satellites,
              {
                id: nextId('sa'),
                angle: 45,
                distance: 1.4,
                size: 0.06,
                color: { slot: 6 },
                opacity: 0.9,
                strokeWidth: 0,
              },
            ],
          }))
        }
      >
        + Satellite
      </button>

      <Adv>
        <hr className="divider" />
        <div className="eyebrow">Crescent rim light</div>
        {/* Only the rim goes inert under flat mode — rings and satellites above are
            graphic, not depth cues, and stay editable. */}
        {suppressRim && <div className="note">Flat mode — rim light suppressed.</div>}
        <Inert disabled={suppressRim}>
          <Check
            label="Enabled"
            checked={layer.rim.enabled}
            onChange={(enabled) => onPatch((l) => ({ ...l, rim: { ...l.rim, enabled } }))}
          />
          {layer.rim.enabled && (
            <>
              <Slider
                label="Angle"
                value={layer.rim.angle}
                min={0}
                max={360}
                step={1}
                suffix="°"
                onChange={(angle) => onPatch((l) => ({ ...l, rim: { ...l.rim, angle } }), `rim-a-${layer.id}`)}
              />
              <Slider
                label="Thickness"
                value={layer.rim.width}
                min={0.002}
                max={0.4}
                step={0.002}
                decimals={3}
                onChange={(width) => onPatch((l) => ({ ...l, rim: { ...l.rim, width } }), `rim-w-${layer.id}`)}
              />
              <Slider
                label="Falloff"
                value={layer.rim.spread}
                min={0.05}
                max={2}
                onChange={(spread) => onPatch((l) => ({ ...l, rim: { ...l.rim, spread } }), `rim-s-${layer.id}`)}
              />
              <Slider
                label="Opacity"
                value={layer.rim.opacity}
                min={0}
                max={1}
                onChange={(opacity) => onPatch((l) => ({ ...l, rim: { ...l.rim, opacity } }), `rim-o-${layer.id}`)}
              />
              <Select
                label="Blend mode"
                value={layer.rim.blend}
                options={BLEND_OPTIONS}
                onChange={(blend: BlendMode) => onPatch((l) => ({ ...l, rim: { ...l.rim, blend } }))}
              />
              <ColorRefEditor
                name="Rim color"
                value={layer.rim.color}
                palette={palette}
                showAlpha={false}
                onChange={(color) => onPatch((l) => ({ ...l, rim: { ...l.rim, color } }))}
              />
            </>
          )}
        </Inert>
      </Adv>
    </>
  )
}

function AccentsSection(props: SidebarProps) {
  const { doc, palette, open, onToggleSection, update, onRandomizeSection } = props
  const [more, setMore] = useState(false)
  const layer = doc.layers.find((l): l is AccentLayer => l.kind === 'accent')
  const patch = (recipe: (l: AccentLayer) => AccentLayer, coalesce?: string) => {
    if (!layer) return
    update(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? recipe(l as AccentLayer) : l)),
      }),
      coalesce,
    )
  }

  // A friendly view of stack position: "behind" = below the first pattern
  // layer (a ring behind the orb's texture), "in front" = top of the stack.
  const accentIdx = doc.layers.findIndex((l) => l.kind === 'accent')
  const firstPatternIdx = doc.layers.findIndex((l) => l.kind === 'pattern')
  const behind = accentIdx >= 0 && firstPatternIdx >= 0 && accentIdx < firstPatternIdx
  const setBehind = (toBehind: boolean) =>
    update((d) => {
      const at = d.layers.findIndex((l) => l.kind === 'accent')
      if (at < 0) return d
      const layers = d.layers.slice()
      const [moved] = layers.splice(at, 1)
      if (toBehind) layers.unshift(moved)
      else layers.push(moved)
      return { ...d, layers }
    })

  return (
    <Section
      num="04"
      title="Accents"
      hint={layer ? `${layer.rings.length}R ${layer.satellites.length}S` : 'none'}
      open={open.accents}
      onToggle={() => onToggleSection('accents')}
      lock={{
        section: 'accents',
        on: doc.locks.accents,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, accents: on } })),
      }}
      randomize={{
        label: 'Randomize the accents only',
        onRandomize: () => onRandomizeSection('accents'),
        disabled: doc.locks.accents,
      }}
      more={{ on: more, onToggle: setMore }}
    >
      {!layer ? (
        <div className="note">
          No accent layer yet. Add one from Orb → more settings → Stack → + Accents.
        </div>
      ) : (
        <>
          <Check label="Visible" checked={layer.visible} onChange={(visible) => patch((l) => ({ ...l, visible }))} />
          <Segmented
            label="Placement"
            value={behind ? 'behind' : 'front'}
            options={[
              { value: 'behind', label: 'behind orb' },
              { value: 'front', label: 'in front' },
            ]}
            onChange={(v) => setBehind(v === 'behind')}
          />
          <AccentControls layer={layer} palette={palette} onPatch={patch} suppressRim={doc.flat} />
        </>
      )}
    </Section>
  )
}

/* ---------- 05 Export ---------- */

function ExportSection(props: SidebarProps) {
  const { open, onToggleSection } = props
  const [more, setMore] = useState(false)
  return (
    <Section
      num="06"
      title="Export"
      open={open.export}
      onToggle={() => onToggleSection('export')}
      more={{ on: more, onToggle: setMore }}
    >
      <ExportPanel {...props.exportPanel} />
    </Section>
  )
}

/* ---------- 04 Canvas ---------- */

type BgQuick = 'black' | 'white' | 'transparent' | 'custom'

function bgQuickOf(doc: OrbDoc): BgQuick {
  const bg = doc.background
  if (bg.kind === 'transparent') return 'transparent'
  if (bg.kind === 'solid') {
    const hex = (bg.color.hex ?? '').toLowerCase()
    if (hex === '#000000') return 'black'
    // Under RSAC palettes the WHITE chip writes the brand's light ground,
    // Off White #FDF9F6 (Q8) — both read back as "white" here.
    if (hex === '#ffffff' || hex === '#fdf9f6') return 'white'
  }
  return 'custom'
}

function CanvasSection(props: SidebarProps) {
  const { doc, palette, open, onToggleSection, update, onRandomizeSection } = props
  const [more, setMore] = useState(false)
  const quick = bgQuickOf(doc)
  const bgLabel =
    quick === 'custom' ? doc.background.kind : quick === 'transparent' ? 'transp.' : quick

  const setQuick = (v: BgQuick) => {
    if (v === 'custom') {
      // Reveal the editor without changing what renders.
      update((d) =>
        d.background.kind === 'transparent'
          ? { ...d, background: { ...d.background, kind: 'solid', color: { ...d.background.color, hex: null } } }
          : { ...d, background: { ...d.background, color: { ...d.background.color, hex: null } } },
      )
      return
    }
    update((d) => ({
      ...d,
      background:
        v === 'transparent'
          ? { ...d.background, kind: 'transparent' }
          : {
              ...d.background,
              kind: 'solid',
              // The quick chips write literal hex overrides — the existing
              // per-element override mechanism, no new model. WHITE is
              // brand-true under RSAC palettes: the light ground is Off White
              // #FDF9F6, not #FFFFFF (Q8); literal white elsewhere.
              color: {
                ...d.background.color,
                hex:
                  v === 'black'
                    ? '#000000'
                    : d.paletteId.startsWith('rsac-')
                      ? '#FDF9F6'
                      : '#ffffff',
              },
            },
    }))
  }

  return (
    <Section
      num="05"
      title="Canvas"
      hint={`${doc.canvas.width}×${doc.canvas.height} · ${bgLabel}`}
      open={open.canvas}
      onToggle={() => onToggleSection('canvas')}
      lock={{
        section: 'background',
        on: doc.locks.background,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, background: on } })),
      }}
      randomize={{
        label: 'Randomize the background only',
        onRandomize: () => onRandomizeSection('background'),
        disabled: doc.locks.background,
      }}
      more={{ on: more, onToggle: setMore }}
    >
      <Segmented
        label="Background"
        value={quick}
        options={[
          { value: 'black', label: 'black' },
          { value: 'white', label: 'white' },
          { value: 'transparent', label: 'transp.' },
          { value: 'custom', label: 'custom…' },
        ]}
        onChange={setQuick}
      />
      {quick === 'custom' && (
        <>
          <Segmented
            label="Fill"
            value={doc.background.kind}
            options={[
              { value: 'solid', label: 'solid' },
              { value: 'gradient', label: 'gradient' },
            ]}
            onChange={(kind) => update((d) => ({ ...d, background: { ...d.background, kind } }))}
          />
          {doc.background.kind === 'solid' && (
            <ColorRefEditor
              name="Background color"
              value={doc.background.color}
              palette={palette}
              onChange={(color) => update((d) => ({ ...d, background: { ...d.background, color } }))}
            />
          )}
          {doc.background.kind === 'gradient' && (
            <GradientEditor
              gradient={doc.background.gradient}
              palette={palette}
              onChange={(gradient, coalesce) =>
                update((d) => ({ ...d, background: { ...d.background, gradient } }), coalesce)
              }
            />
          )}
        </>
      )}
      <Adv>
        <Slider
          label="Vignette"
          value={doc.background.vignette}
          min={0}
          max={1}
          onChange={(vignette) =>
            update((d) => ({ ...d, background: { ...d.background, vignette } }), 'bg-vig')
          }
        />
      </Adv>
      <hr className="divider" />
      <Segmented
        label="Aspect"
        value={
          ASPECTS.find((a) => a.w === doc.canvas.width && a.h === doc.canvas.height)?.label ??
          'custom'
        }
        options={[...ASPECTS.map((a) => ({ value: a.label, label: a.label })), { value: 'custom', label: 'custom' }]}
        onChange={(label) => {
          const a = ASPECTS.find((x) => x.label === label)
          if (a) update((d) => ({ ...d, canvas: { width: a.w, height: a.h } }))
        }}
      />
      <Adv>
        <div className="grid2">
          <NumberField
            label="Width px"
            value={doc.canvas.width}
            min={64}
            max={8192}
            onChange={(width) => update((d) => ({ ...d, canvas: { ...d.canvas, width } }))}
          />
          <NumberField
            label="Height px"
            value={doc.canvas.height}
            min={64}
            max={8192}
            onChange={(height) => update((d) => ({ ...d, canvas: { ...d.canvas, height } }))}
          />
        </div>
      </Adv>
      <button
        type="button"
        className="btn btn--block"
        onClick={() =>
          update((d) => ({ ...d, canvas: { width: d.canvas.height, height: d.canvas.width } }))
        }
      >
        Swap orientation
      </button>
    </Section>
  )
}

/* ---------- photos section: the pool Remix builds compositions around ---------- */

/**
 * The document's photo pool. Browsing, favorites and site-wide framing live
 * in the full-page photo library (header → Photos); this section is the pool
 * itself: which photos, how many per orb, and quick framing tweaks.
 */
function PhotosSection(props: SidebarProps) {
  const { doc, open, onToggleSection, update } = props
  const pool = doc.photoPool
  const library = usePhotoLibrary()
  const photoPrefs = usePhotoPrefs()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const hidden = new Set(photoPrefs.prefs.hidden)
  const favorites = photoPrefs.prefs.favorites.filter((id) => library.byId.has(id) && !hidden.has(id))
  const missingFavorites = favorites.filter((id) => !pool.photos.some((p) => p.photoId === id))

  const addEntries = (entries: PoolPhoto[]) =>
    update((d) => entries.reduce((acc, e) => withPoolPhoto(acc, e, true), d))
  const setRange = (min: number, max: number) =>
    update((d) => ({ ...d, photoPool: { ...d.photoPool, min, max } }), 'photo-range')

  return (
    <Section
      num="02"
      title="Photos"
      hint={pool.photos.length ? `${pool.photos.length} in pool` : undefined}
      open={open.photos}
      onToggle={() => onToggleSection('photos')}
      more={{ on: more, onToggle: setMore }}
    >
      <div className="row">
        {library.list.length > 0 && (
          <button type="button" className="btn" onClick={props.onOpenPhotoLibrary}>
            Photo library ({library.list.length})
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Adding…' : 'Upload'}
        </button>
      </div>
      {missingFavorites.length > 0 && (
        <button
          type="button"
          className="btn btn--block"
          title="Add every favorite from the photo library to this pool"
          onClick={() =>
            addEntries(
              missingFavorites.map((id) => ({ photoId: id, ...framingFor(library.byId.get(id), photoPrefs.prefs, id) })),
            )
          }
        >
          + {missingFavorites.length} favorite{missingFavorites.length === 1 ? '' : 's'} to the pool
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="offstage"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length === 0) return
          setBusy(true)
          const added: PoolPhoto[] = []
          for (const file of files) {
            const photo = await props.onImportPhoto(file)
            if (photo) added.push({ photoId: photo.id, zoom: 1, focusX: 0.5, focusY: 0.5 })
          }
          setBusy(false)
          addEntries(added)
        }}
      />
      {pool.photos.length === 0 && (
        <div className="note">
          Add photos to the pool — from the photo library, your favorites, or an upload. Remix and Batch then
          fill segments with different photos from it, each framed as set in the library.
        </div>
      )}
      {pool.photos.length > 0 && (
        <>
          <Slider
            label="Fewest photos per orb"
            value={pool.min}
            min={0}
            max={MAX_PHOTOS_PER_ORB}
            step={1}
            onChange={(min) => setRange(min, Math.max(min, pool.max))}
          />
          <Slider
            label="Most photos per orb"
            value={pool.max}
            min={0}
            max={MAX_PHOTOS_PER_ORB}
            step={1}
            onChange={(max) => setRange(Math.min(pool.min, max), max)}
          />
          <div className="note">
            {pool.max === 0
              ? 'Remix places no photos while the most is 0.'
              : `Remix and Batch put ${pool.min === pool.max ? pool.min : `${pool.min}–${pool.max}`} different pool photo${pool.max === 1 ? '' : 's'} into each orb’s segments — switching to Segments unless the orb type is locked, and adding cells when a split has too few.`}
            {pool.max > pool.photos.length && ` The pool has only ${pool.photos.length}.`}
          </div>
          <div className="poolgrid">
            {pool.photos.map((entry) => {
              const meta = library.byId.get(entry.photoId)
              return (
                <figure className="poolgrid__item" key={entry.photoId} title={meta?.name ?? 'Missing photo'}>
                  {meta ? (
                    <FocalPointPicker
                      src={meta.thumbUrl}
                      width={meta.width}
                      height={meta.height}
                      focusX={entry.focusX}
                      focusY={entry.focusY}
                      maxHeight={90}
                      onChange={(focusX, focusY) =>
                        photoPrefs.reframe(entry.photoId, { focusX, focusY }, `pool-${entry.photoId}-focus`)
                      }
                    />
                  ) : (
                    <div className="note">Missing photo</div>
                  )}
                  <button
                    type="button"
                    className="poolgrid__remove"
                    title="Remove from the pool (it stays in the library)"
                    aria-label={`Remove ${meta?.name ?? 'photo'} from the pool`}
                    onClick={() => update((d) => withPoolPhoto(d, entry, false))}
                  >
                    ×
                  </button>
                </figure>
              )
            })}
          </div>
          <Adv>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => update((d) => ({ ...d, photoPool: { ...d.photoPool, photos: [] } }))}
            >
              Clear the pool
            </button>
          </Adv>
        </>
      )}
    </Section>
  )
}

/* ---------- the sidebar ---------- */

export function Sidebar(props: SidebarProps) {
  const { doc, palette, open, onToggleSection, update } = props
  const [paletteMore, setPaletteMore] = useState(false)

  return (
    // Disclosure is per section and per card — each scope's "more settings"
    // toggle sits beside its lock. There is deliberately no app-wide mode.
    <Scope advanced={false}>
      <aside className="sidebar">
        {/* 01 — Orb */}
        <OrbSection {...props} />

        {/* 02 — Photos */}
        <PhotosSection {...props} />

        {/* 03 — Palette */}
        <Section
          num="03"
          title="Palette"
          hint={palette.name}
          open={open.palette}
          onToggle={() => onToggleSection('palette')}
          lock={{
            section: 'colors',
            on: doc.locks.colors,
            onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, colors: on } })),
            partial: doc.subLocks.colors.palette ? 1 : 0,
            partialTitle:
              'Remix All keeps this palette but may still re-deal slot assignments. The full lock freezes every color assignment too.',
          }}
          randomize={{
            label: 'Switch to a random palette',
            onRandomize: props.onRandomizePalette,
            disabled: doc.locks.colors,
          }}
          more={{ on: paletteMore, onToggle: setPaletteMore }}
        >
          <Check
            label="Keep palette — remix still re-deals inks within it"
            checked={doc.subLocks.colors.palette}
            onChange={(palette) =>
              update((d) => ({
                ...d,
                subLocks: { ...d.subLocks, colors: { ...d.subLocks.colors, palette } },
              }))
            }
          />
          {doc.subLocks.colors.palette && !doc.locks.colors && (
            <div className="note">
              Remix All stays on this palette but re-deals which of its colors everything
              wears. To freeze every color assignment too, use the section LOCK above.
            </div>
          )}
          <Segmented
            label="Color via"
            value={doc.colorSource}
            options={[
              { value: 'palette', label: 'palette' },
              { value: 'gradients', label: 'brand gradients' },
            ]}
            onChange={(colorSource) => update((d) => ({ ...d, colorSource }))}
          />
          {doc.colorSource === 'gradients' && (
            <div className="note">
              Remix delivers color through the named RSAC gradients instead of dealing palette
              ramps — the collection wears only brand assets.
            </div>
          )}
          <BrandGradientStrip />
          <PalettePanel palette={palette} {...props.palettePanel} />
        </Section>

        {/* 04 — Accents */}
        <AccentsSection {...props} />

        {/* 05 — Canvas */}
        <CanvasSection {...props} />

        {/* 06 — Export */}
        <ExportSection {...props} />
      </aside>
    </Scope>
  )
}
