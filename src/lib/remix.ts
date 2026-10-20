/**
 * Seeded remix. Same seed + same palette + same locks ⇒ same output.
 *
 * **Fixed-width candidates.** Every candidate is drawn unconditionally, in a
 * fixed order, and at its *maximum* width: all `MAX_PATTERN_LAYERS` pattern
 * layers, all `MAX_SECTOR_CELLS` cells per row, every count rolled whether or
 * not it is used. Locks — section locks, sub-locks, and per-object property
 * locks — are then applied purely as a selection between candidate values and
 * incoming values, consuming zero draws. The invariant is strict: the number
 * of draws depends on the seed and on doc/deps state (does a shading layer
 * exist, are any patterns parsed), never on any lock at any level.
 *
 * When adding to this function, never branch on a lock in a way that changes
 * how many values are drawn — compute both, then choose.
 *
 * **A lock is absolute.** Nothing in this module writes to a locked value:
 * not Remix, not Remix All, not Shuffle colors, not a per-section randomize.
 * Every entry point guards on the locks, so a locked value cannot be changed
 * by accident from a caller that forgot to check. Property locks inherit the
 * same doctrine, plus **existence implication**: a lock on a child implies the
 * lock that guarantees the child's existence — any locked cell pins the sector
 * structure, any locked layer pins the pattern-layer count. Implications are
 * derived here, never stored, so no bookkeeping can drift.
 */

import {
  type AccentLayer,
  type Background,
  type LayerMask,
  type Orb,
  type OrbType,
  type PhotoPool,
  type SectorFill,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type GradientStop,
  type Layer,
  type LockSection,
  type Locks,
  type Palette,
  type PatternLayer,
  type OrbDoc,
  type ShadingLayer,
} from '../types'
import { makeRng, type Rng } from './rng'
import { sectorCellAreas } from './geometry'
import { DEFAULT_LAYER_MASK, nextId } from './defaults'
import type { ParsedPattern } from './patterns/parse'
import { paperSlots, slotsByLightness } from './palettes'
import { PICKABLE_BRAND_GRADIENTS, brandGradientFor } from './brand'

export type RemixDeps = {
  /** Patterns that are parsed and therefore safe to reference. */
  available: ParsedPattern[]
  palette: Palette
  /**
   * Which pool photos this browser can actually show (uploads plus the
   * connected library's catalog). Pool photos it rejects are left out of the
   * deal, so a pool carried by a preset or document does not paint empty
   * cells where the library is missing. Absent = every photo is available.
   */
  photoAvailable?: (photoId: string) => boolean
}

/** The fixed candidate widths. Selection uses a prefix; draws always run full. */
export const MAX_PATTERN_LAYERS = 3
export const MAX_SECTOR_CELLS = 3

/* ---------- lock helpers ---------- */

const hasAnyLock = (obj: { locks?: Partial<Record<string, boolean>> } | undefined): boolean =>
  !!obj?.locks && Object.values(obj.locks).some(Boolean)

/** Existence implication: any locked cell pins the whole sector structure. */
export function structureLockedFor(doc: OrbDoc): boolean {
  return (
    doc.locks.orb ||
    doc.subLocks.orb.structure ||
    [...doc.orb.sectors.rowA, ...doc.orb.sectors.rowB].some(hasAnyLock)
  )
}

/** Existence implication: any locked layer pins the pattern-layer count. */
export function patternCountLockedFor(doc: OrbDoc): boolean {
  const prevPatterns = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
  return doc.locks.patterns || doc.subLocks.patterns.count || prevPatterns.some(hasAnyLock)
}

/* ---------- color dealing ---------- */

type Deck = {
  dark: number[]
  mid: number[]
  light: number[]
  all: number[]
  /** Near-white neutrals — kept out of area fills (see `paperSlots`). */
  paper: Set<number>
}

function buildDeck(palette: Palette): Deck {
  const byL = slotsByLightness(palette)
  const third = Math.max(1, Math.round(byL.length / 3))
  return {
    dark: byL.slice(0, third),
    mid: byL.slice(third, byL.length - third).length ? byL.slice(third, byL.length - third) : byL,
    light: byL.slice(-third).reverse(),
    all: byL,
    paper: paperSlots(palette),
  }
}

/** A pool without its paper slots — unless that would empty it. */
function withoutPaper(pool: number[], deck: Deck): number[] {
  const kept = pool.filter((s) => !deck.paper.has(s))
  return kept.length > 0 ? kept : pool
}

/** A run of adjacent-in-lightness slots, which is what reads as a sweep. */
function dealRamp(rng: Rng, palette: Palette, count: number): number[] {
  const byL = slotsByLightness(palette)
  const len = byL.length
  const n = Math.max(1, Math.min(count, len))

  // Contiguous and non-wrapping: a run that wraps past the light end back into
  // the dark slots can come out entirely dark, which reads as a black hole
  // against a dark background rather than as a orb.
  let start = rng.int(0, Math.max(0, len - n))
  // And make sure it reaches the light end, so there is somewhere for the
  // shading highlight to land.
  const minEnd = Math.max(n - 1, len - 3)
  if (start + n - 1 < minEnd) start = Math.max(0, minEnd - n + 1)

  const run = Array.from({ length: n }, (_, i) => byL[Math.min(len - 1, start + i)])
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(run[i % n])
  return rng.bool(0.5) ? out : out.reverse()
}

/* ---------- gradients ---------- */

function remixGradient(rng: Rng, palette: Palette, prev: Gradient, lockColors: boolean): Gradient {
  const type = rng.weighted(['conic', 'linear', 'radial'] as const, [0.46, 0.32, 0.22])
  const stopCount = type === 'conic' ? rng.int(5, 8) : rng.int(3, 5)
  const slots = dealRamp(rng, palette, stopCount)

  // Drawn unconditionally and discarded when colors are locked — see the
  // draws-always rule in the module header.
  const drawnStops: GradientStop[] = slots.map((slot, i) => {
    const base = stopCount === 1 ? 0 : i / (stopCount - 1)
    const jitter = i === 0 || i === stopCount - 1 ? 0 : rng.float(-0.05, 0.05)
    return {
      id: nextId('s'),
      offset: Math.max(0, Math.min(1, base + jitter)),
      color: { slot } as ColorRef,
    }
  })
  // A conic sweep should close on itself or it shows a hard seam.
  if (type === 'conic' && drawnStops.length > 2) {
    drawnStops[drawnStops.length - 1] = {
      ...drawnStops[drawnStops.length - 1],
      color: { ...drawnStops[0].color },
    }
  }

  // Locked colors keep the existing colors but still get re-spaced.
  const existing = prev.stops.slice().sort((a, b) => a.offset - b.offset)
  const keptCount = Math.max(2, existing.length)
  const stops: GradientStop[] = lockColors
    ? Array.from({ length: keptCount }, (_, i) => ({
        id: nextId('s'),
        offset: keptCount === 1 ? 0 : i / (keptCount - 1),
        color: existing[i % existing.length].color,
      }))
    : drawnStops

  // A conic whose convergence point lands mid-disc reads as a pinwheel, so
  // push it out near the limb where the terminator hides it.
  const edgeward = (): number => (rng.bool() ? rng.float(-0.05, 0.14) : rng.float(0.86, 1.05))

  return {
    type,
    angle: rng.int(0, 359),
    stops,
    focusX: type === 'conic' ? edgeward() : rng.float(0.34, 0.66),
    focusY: type === 'conic' ? rng.float(0.3, 0.7) : rng.float(0.34, 0.66),
    radius: rng.float(0.55, 1.05),
    segments: type === 'conic' ? rng.pick([160, 200, 240, 300]) : prev.segments,
  }
}

/**
 * Select between the slot-ramp candidate and a named brand gradient — the
 * `colorSource` standing preference made operational. The brand pick is a
 * unit float drawn unconditionally at every gradient site (count-independent,
 * so growing the brand set never shifts the stream); this function consumes
 * no draws. Colors-locked documents keep their incoming stops either way —
 * the colors lock outranks the color source.
 */
function selectGradient(
  candidate: Gradient,
  brandPick: number,
  doc: OrbDoc,
  palette: Palette,
  lockColors: boolean,
): Gradient {
  if (lockColors || doc.colorSource !== 'gradients') return candidate
  const pool = PICKABLE_BRAND_GRADIENTS
  const brand = pool[Math.min(pool.length - 1, Math.floor(brandPick * pool.length))]
  return brandGradientFor(brand, palette, candidate)
}

/* ---------- layers ---------- */

const OVERLAY_BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'soft-light', 'overlay']

function remixPatternColors(
  rng: Rng,
  parsed: ParsedPattern,
  palette: Palette,
  blend: BlendMode,
): ColorRef[] {
  const deck = buildDeck(palette)
  const pool =
    blend === 'multiply'
      ? deck.dark
      : blend === 'screen' || blend === 'soft-light'
        ? deck.light
        : blend === 'overlay'
          ? [...deck.light, ...deck.mid]
          : // `normal` ink only reads as ink at the ends of the ramp, so skip
            // the mid tones that would just mush into the gradient.
            rng.bool()
            ? deck.dark
            : deck.light
  const shuffled = rng.shuffle(pool.length ? pool : deck.all)
  let i = 0
  // The plate stays hidden most of the time so patterns read as texture.
  const showPlate = rng.bool(0.12)
  return parsed.groups.map((g) => {
    if (g.isBackground) {
      return showPlate
        ? { slot: deck.dark[0] ?? 0, alpha: rng.float(0.12, 0.4) }
        : { slot: deck.dark[0] ?? 0, alpha: 0 }
    }
    const slot = shuffled[i++ % shuffled.length]
    return { slot, alpha: 1 }
  })
}

function remixPatternLayer(
  rng: Rng,
  deps: RemixDeps,
  prev?: PatternLayer,
  lockColors = false,
): PatternLayer {
  const parsed = rng.pick(deps.available)
  const blend = rng.weighted(OVERLAY_BLENDS, [0.34, 0.22, 0.18, 0.14, 0.12])
  const fit = rng.bool(0.24) ? 'cover' : 'tile'
  // Dealt unconditionally so the stream does not depend on the colors lock.
  const dealtColors = remixPatternColors(rng, parsed, deps.palette, blend)
  const colors =
    lockColors && prev
      ? // Keep the palette assignment but stretch/trim to the new pattern.
        parsed.groups.map((g, i) => prev.colors[i] ?? prev.colors[prev.colors.length - 1] ?? { slot: 0, alpha: g.isBackground ? 0 : 1 })
      : dealtColors

  // Most layers cover the whole disc; a minority get a feathered lens so
  // textures sometimes meet in patches instead of always blanketing the orb.
  const maskMode = rng.weighted(['orb', 'lens', 'outside-lens'] as const, [0.6, 0.24, 0.16])
  const mask: LayerMask =
    maskMode === 'orb'
      ? { ...DEFAULT_LAYER_MASK }
      : {
          mode: maskMode,
          cx: rng.float(-0.4, 0.4),
          cy: rng.float(-0.4, 0.4),
          radius: rng.float(0.6, 1.15),
          feather: rng.bool(0.7) ? rng.float(0.25, 0.75) : 0,
        }

  return {
    kind: 'pattern',
    id: prev?.id ?? nextId('pl'),
    name: parsed.name,
    visible: true,
    patternId: parsed.id,
    fit,
    mask,
    scale: fit === 'cover' ? rng.float(0.9, 1.8) : rng.float(0.35, 2.6),
    rotation: rng.bool(0.4) ? 0 : rng.int(-45, 45),
    offsetX: rng.float(-0.2, 0.2),
    offsetY: rng.float(-0.2, 0.2),
    // Flat ink can carry much more opacity than a blended wash before it
    // stops looking deliberate.
    opacity: blend === 'normal' ? rng.float(0.38, 0.95) : rng.float(0.24, 0.7),
    blend,
    colors,
  }
}

/**
 * Per-property selection between a fully-drawn candidate and the incoming
 * layer — the property-lock tier. Consumes no draws. The layer's identity
 * (id, its own locks) always survives; each guarded property keeps the
 * incoming value, everything else takes the candidate's.
 */
function selectLayer(
  cand: PatternLayer,
  prev: PatternLayer | undefined,
  deps: RemixDeps,
): PatternLayer {
  if (!prev) return cand
  const k = prev.locks ?? {}
  const pat = k.pattern ? prev : cand
  const parsed = deps.available.find((p) => p.id === pat.patternId)
  // Colors drawn for the candidate's pattern cycle onto the selected pattern's
  // group count — same rule the colors lock has always used.
  const fitColors = (refs: ColorRef[]): ColorRef[] =>
    parsed
      ? parsed.groups.map(
          (g, i) => refs[i] ?? refs[refs.length - 1] ?? { slot: 0, alpha: g.isBackground ? 0 : 1 },
        )
      : refs
  return {
    ...cand,
    id: prev.id,
    patternId: pat.patternId,
    name: pat.name,
    colors: k.color ? fitColors(prev.colors) : fitColors(cand.colors),
    scale: k.scale ? prev.scale : cand.scale,
    offsetX: k.position ? prev.offsetX : cand.offsetX,
    offsetY: k.position ? prev.offsetY : cand.offsetY,
    rotation: k.rotation ? prev.rotation : cand.rotation,
    locks: prev.locks,
  }
}

function remixShading(rng: Rng, palette: Palette, prev: ShadingLayer, lockColors: boolean): ShadingLayer {
  const deck = buildDeck(palette)
  return {
    ...prev,
    shadow: rng.float(0.55, 0.95),
    highlight: rng.float(0.18, 0.6),
    lightAngle: rng.int(0, 359),
    lightDistance: rng.float(0.3, 0.68),
    highlightSize: rng.float(0.6, 1.25),
    contactShadow: rng.float(0.2, 0.6),
    shadowColor: lockColors ? prev.shadowColor : { slot: deck.dark[0] ?? 0 },
    highlightColor: lockColors ? prev.highlightColor : { slot: deck.light[0] ?? palette.colors.length - 1 },
    blend: 'normal',
    opacity: 1,
  }
}

function remixAccents(rng: Rng, palette: Palette, prev: AccentLayer, lockColors: boolean): AccentLayer {
  const deck = buildDeck(palette)
  // Draws either way; the lock only decides which value is used.
  const pickAccent = (fallback: ColorRef): ColorRef => {
    const drawn: ColorRef = { slot: rng.pick([...deck.light, ...deck.mid]) }
    return lockColors ? fallback : drawn
  }

  const ringCount = rng.weighted([0, 1, 1, 2, 3], [0.16, 0.3, 0.2, 0.24, 0.1])
  const rings = Array.from({ length: ringCount }, (_, i) => ({
    id: prev.rings[i]?.id ?? nextId('r'),
    radius: rng.float(1.05, 1.55),
    start: rng.int(0, 359),
    sweep: rng.pick([140, 180, 210, 250, 290, 340]),
    width: rng.float(1.2, 5),
    color: pickAccent(prev.rings[i]?.color ?? { slot: deck.light[0] ?? 0 }),
    opacity: rng.float(0.3, 0.85),
    tilt: rng.bool(0.35) ? 1 : rng.float(0.18, 0.7),
    rotation: rng.int(-40, 40),
    dash: rng.bool(0.22) ? rng.float(3, 14) : 0,
  }))

  const satCount = rng.weighted([0, 1, 2, 3], [0.3, 0.34, 0.24, 0.12])
  const satellites = Array.from({ length: satCount }, (_, i) => ({
    id: prev.satellites[i]?.id ?? nextId('sa'),
    angle: rng.int(0, 359),
    distance: rng.float(1.15, 1.6),
    size: rng.float(0.025, 0.09),
    color: pickAccent(prev.satellites[i]?.color ?? { slot: deck.light[0] ?? 0 }),
    opacity: rng.float(0.55, 1),
    strokeWidth: rng.bool(0.25) ? rng.float(1, 3) : 0,
  }))

  // Drawn but only honored when the incoming rim was already on: the v2
  // direction avoids lighting cues, so remix never *introduces* the rim — it
  // only re-deals one the user (or a legacy document) already has.
  const rimOn = rng.bool(0.68) && prev.rim.enabled
  return {
    ...prev,
    rings,
    satellites,
    rim: {
      enabled: rimOn,
      angle: rng.int(0, 359),
      // Past ~0.06 the lune stops reading as a rim light and becomes a sliver.
      width: rng.float(0.012, 0.06),
      spread: rng.float(0.2, 0.7),
      color: pickAccent(prev.rim.color),
      opacity: rng.float(0.4, 0.9),
      blend: rng.pick(['screen', 'overlay', 'normal'] as BlendMode[]),
    },
  }
}

/* ---------- sector cells ---------- */

/** Every ColorRef a fill carries, in a stable order. */
function refsOf(fill: SectorFill): ColorRef[] {
  if (fill.kind === 'flat') return [fill.color]
  if (fill.kind === 'ramp') return [fill.from, fill.to]
  if (fill.kind === 'photo') return [] // the user's own picture carries no inks
  return fill.colors
}

/** The same fill wearing a different set of refs, cycled to its width. */
function withRefs(fill: SectorFill, refs: ColorRef[]): SectorFill {
  if (refs.length === 0 || fill.kind === 'photo') return fill
  const at = (i: number) => refs[i % refs.length]
  if (fill.kind === 'flat') return { ...fill, color: at(0) }
  if (fill.kind === 'ramp') return { ...fill, from: at(0), to: at(1) }
  return { ...fill, colors: fill.colors.map((_, i) => at(i)) }
}

/**
 * Inks carried over from a *different* fill — the candidate under a fill lock,
 * or the incoming document's inks under the colors lock. Unlike `withRefs`
 * (which restores a cell's own refs exactly), the source may hold a texture's
 * hidden plate (alpha 0): copied verbatim into a flat or ramp cell, that made
 * the cell invisible. So only visible inks transplant, and a texture's hidden
 * groups stay hidden rather than becoming an opaque plate that buries its own
 * ink. With no visible source ink the fill keeps its own refs.
 */
function transplantRefs(fill: SectorFill, refs: ColorRef[]): SectorFill {
  const visible = refs.filter((c) => (c.alpha ?? 1) > 0.001)
  if (visible.length === 0) return fill
  if (fill.kind === 'texture') {
    let k = 0
    return {
      ...fill,
      colors: fill.colors.map((c) => ((c.alpha ?? 1) <= 0.001 ? c : visible[k++ % visible.length])),
    }
  }
  return withRefs(fill, visible)
}

/**
 * Per-property selection for one segment cell. `fill` is the cell's identity
 * (kind + pattern); `color` its inks; `scale`/`rotation` its texture geometry
 * (rotation doubles as the ramp angle — the one authored rotation a ramp has).
 * Consumes no draws.
 */
function selectCell(cand: SectorFill, prev: SectorFill | undefined): SectorFill {
  if (!prev) return cand
  const k = prev.locks ?? {}
  // Identity first: fill locked keeps the incoming kind + pattern wholesale,
  // then unlocked properties are re-applied from the candidate onto it.
  const base: SectorFill = k.fill ? structuredClone(prev) : structuredClone(cand)

  let out = base
  if (k.color) out = withRefs(out, refsOf(prev))
  else if (k.fill) out = transplantRefs(out, refsOf(cand))

  if (out.kind === 'texture') {
    const prevTex = prev.kind === 'texture' ? prev : undefined
    const candTex = cand.kind === 'texture' ? cand : undefined
    out = {
      ...out,
      scale: k.scale ? (prevTex?.scale ?? out.scale) : (candTex?.scale ?? out.scale),
      rotation: k.rotation ? (prevTex?.rotation ?? out.rotation) : (candTex?.rotation ?? out.rotation),
    }
  } else if (out.kind === 'ramp') {
    const prevAngle = prev.kind === 'ramp' ? prev.angle : undefined
    const candAngle = cand.kind === 'ramp' ? cand.angle : undefined
    out = {
      ...out,
      angle: k.rotation ? (prevAngle ?? out.angle) : (candAngle ?? out.angle),
    }
  }
  return { ...out, locks: prev.locks }
}

/**
 * Place pool photos. The count is drawn in [min, max]; fill-locked cells are
 * never written (a lock is absolute), and a fill-locked cell already showing
 * a pool photo counts toward the total and takes that photo out of the draw —
 * the user pinned it. Each placed photo is a different pool photo in a
 * different cell, wearing its pool framing and the replaced cell's locks.
 * Pure selection: every pick is drawn by the caller.
 */
function placePoolPhotos(
  pool: PhotoPool,
  rowA: SectorFill[],
  rowB: SectorFill[],
  picks: { cell: number; photo: number }[],
  countPick: number,
  areas: number[],
): [SectorFill[], SectorFill[]] {
  if (pool.photos.length === 0 || pool.max < 1) return [rowA, rowB]
  const cells = [...rowA, ...rowB]
  const inPool = new Set(pool.photos.map((p) => p.photoId))
  const pinned = new Set(
    cells.flatMap((f) => (f.locks?.fill && f.kind === 'photo' && inPool.has(f.photoId) ? [f.photoId] : [])),
  )
  const lo = Math.max(0, Math.min(pool.min, pool.max))
  const target = Math.min(pool.max, lo + Math.floor(countPick * (pool.max - lo + 1)))
  const free = cells.flatMap((f, i) => (f.locks?.fill ? [] : [i]))
  const avail = pool.photos.filter((p) => !pinned.has(p.photoId))
  const n = Math.min(target - pinned.size, free.length, avail.length, picks.length)
  const at = (list: unknown[], pick: number) => Math.min(list.length - 1, Math.floor(pick * list.length))
  // Big cells first: a photo in a sliver reads as a mistake. Each pick is
  // weighted by area³ — the largest free cell wins most of the time, but not
  // always, so a 2-photo orb still varies. Pure selection over `pick.cell`.
  const weightedAt = (pick: number) => {
    const w = free.map((i) => Math.pow(areas[i] ?? 0, 3))
    const total = w.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return at(free, pick)
    let t = pick * total
    for (let j = 0; j < free.length; j++) {
      t -= w[j]
      if (t <= 0) return j
    }
    return free.length - 1
  }
  for (let k = 0; k < n; k++) {
    const cellIndex = free.splice(weightedAt(picks[k].cell), 1)[0]
    const photo = avail.splice(at(avail, picks[k].photo), 1)[0]
    cells[cellIndex] = { kind: 'photo', ...photo, locks: cells[cellIndex].locks }
  }
  return [cells.slice(0, rowA.length), cells.slice(rowA.length)]
}

/* ---------- entry points ---------- */

/**
 * Pick a palette from the seed. Kept here rather than in the caller so the same
 * seed reproduces the palette choice too, and so the `colors` lock and the
 * `colors.palette` sub-lock still win (callers guard on both).
 */
export function pickPalette(palettes: Palette[], seed: string, current: string): Palette {
  if (palettes.length === 0) return { id: current, name: current, colors: ['#000000'] }
  const rng = makeRng(`${seed}-palette`)
  const others = palettes.filter((p) => p.id !== current)
  const pool = others.length > 0 ? others : palettes
  return rng.pick(pool)
}

export function remix(doc: OrbDoc, seed: string, deps: RemixDeps): OrbDoc {
  const rng = makeRng(seed)
  const { locks, subLocks } = doc
  const palette = deps.palette
  const deck = buildDeck(palette)

  const prevPatterns = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
  const prevShading = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const prevAccents = doc.layers.find((l): l is AccentLayer => l.kind === 'accent')

  /*
   * DRAW PHASE — everything below is drawn unconditionally, in this order, at
   * fixed width. No lock is consulted until the select phase. (`locks.colors`
   * appears inside a few draw helpers, but only ever as a selection over draws
   * those helpers still make — the pattern the module header describes.)
   */

  // --- background candidate ---
  const bgKind = rng.weighted(['gradient', 'solid', 'transparent'] as const, [0.66, 0.28, 0.06])
  const bgGradient = remixGradient(rng, palette, doc.background.gradient, locks.colors)
  // Backgrounds want a quiet, dark-leaning ramp.
  const bgRadial = rng.bool(0.6)
  const bgStops: GradientStop[] = [
    { id: nextId('s'), offset: 0, color: { slot: deck.dark[rng.int(0, deck.dark.length - 1)] } },
    { id: nextId('s'), offset: rng.float(0.5, 0.8), color: { slot: deck.dark[0] } },
    { id: nextId('s'), offset: 1, color: { slot: deck.dark[0] } },
  ]
  const bgRadius = rng.float(0.7, 1.1)
  const bgVignette = rng.float(0.1, 0.5)
  const bgBrandPick = rng.float(0, 1)

  // --- orb type candidate ---
  // The collage still leads, per the v2 direction; sliced is retired and is
  // not dealt at all.
  const typeCandidate = rng.weighted(
    ['color', 'pattern', 'segments'] as OrbType[],
    [0.26, 0.32, 0.42],
  )

  // --- sector structure + cell candidates, always full width ---
  // Mostly free angles now (was 44/28/28 h/v/free — three in four orbs cut
  // square to the frame, 2026-10-13). One weighted draw either way.
  const sectorAngleKind = rng.weighted(['h', 'v', 'free'] as const, [0.2, 0.15, 0.65])
  const sectorFreeAngle = rng.int(0, 359)
  const sectorAngle =
    sectorAngleKind === 'h' ? 0 : sectorAngleKind === 'v' ? 90 : sectorFreeAngle
  const sectorOffsetDraw = rng.float(-0.45, 0.45)
  // A dead-centre chord a quarter of the time (was 55%: half of all orbs
  // split exactly 50/50).
  const sectorOffset = rng.bool(0.25) ? 0 : sectorOffsetDraw
  // Cells deal from the whole enabled pool. This used to prefer the tx-
  // procedurals — written when the only file patterns were heavy geometry
  // grids — which silently vetoed every curated file pattern from every
  // segment cell (found 2026-08-25: 0 of 31 file patterns in 228 dealt
  // cells). The Library's include-toggles are the curation surface now.
  const cellPool = deps.available
  const dealFill = (): SectorFill => {
    const kind = rng.weighted(['flat', 'ramp', 'texture'] as const, [0.4, 0.2, 0.4])
    // Never deal the ground slot as a flat cell: the background is almost
    // always deck.dark[0], and a cell in the same ink reads as a bite taken
    // out of the disc rather than a sector. Nor a paper slot (near-white
    // neutral), which reads as a missing cell — see `paperSlots`. Pool
    // filtering is selection: `pick` draws once whatever the pool's size.
    const flatPool = withoutPaper(deck.all.filter((s) => s !== deck.dark[0]), deck)
    const slotA = rng.pick(flatPool.length > 0 ? flatPool : deck.all)
    // A ramp ends anywhere in the light or mid band, never on its own start.
    // It used to end in the light third only — with flats and light plates
    // also leaning light, the three lightest non-paper inks took ~37% of all
    // cell area against a fair 25% (2026-10-20). Still one draw.
    const rampEnds = [...deck.light, ...deck.mid].filter((s) => s !== slotA)
    const slotB = rng.pick(rampEnds.length > 0 ? rampEnds : deck.light)
    const rampAngle = rng.int(0, 359)
    const brandPick = rng.float(0, 1)
    if (kind === 'texture' && cellPool.length > 0) {
      const parsed = rng.pick(cellPool)
      // Every texture cell carries its own ground: transparent plates read as
      // holes in the collage — in Figma especially, where a cell of sparse
      // ink over nothing looks like a missing cell (2026-10-13; this used to
      // be a coin flip). The coin is still drawn and now picks the plate's
      // end of the deck: a dark plate with light/mid ink, or a light plate
      // with dark/mid ink. Same draws either way, so the stream is unchanged.
      const darkDraw = rng.bool(0.5)
      const plateDraw = rng.pick(deck.dark)
      // Light plates skip paper slots too: a near-white ground is the same
      // empty-looking area as a paper flat cell. A palette whose whole light
      // end is paper (RSAC Neutrals) gets a dark plate instead.
      // A light plate may also be a mid ink: the light third alone left three
      // plate colors on RSAC Spectrum, so every light-plated texture wore
      // blue, yellow or mint (2026-10-20). The paper rule above still holds.
      const lightEnd = deck.light.filter((s) => !deck.paper.has(s))
      const lightPlates = lightEnd.length > 0 ? withoutPaper([...lightEnd, ...deck.mid], deck) : []
      const darkPlate = darkDraw || lightPlates.length === 0
      // `brandPick` (already drawn above, used otherwise only by ramps) picks
      // uniformly — mapping the dark plate's index across folded unevenly.
      const plateSlot = darkPlate
        ? plateDraw
        : lightPlates[Math.min(lightPlates.length - 1, Math.floor(brandPick * lightPlates.length))]
      // Ink never matches its own plate — now possible with a mid plate.
      const inkCands = (darkPlate ? [...deck.light, ...deck.mid] : [...deck.dark, ...deck.mid]).filter(
        (s) => s !== plateSlot,
      )
      const inkPool = inkCands.length > 0 ? inkCands : deck.all
      const colors = parsed.groups.map((g) =>
        g.isBackground ? { slot: plateSlot, alpha: 1 } : { slot: rng.pick(inkPool), alpha: 1 },
      )
      return {
        kind: 'texture',
        patternId: parsed.id,
        colors,
        // Same draw as ever; mapped onto 1–1.8 because a texture cell no
        // longer renders below scale 1 (it would stop covering the cell).
        scale: 1 + ((rng.float(0.7, 1.6) - 0.7) / 0.9) * 0.8,
        rotation: rng.bool(0.8) ? 0 : 90,
      }
    }
    if (kind === 'ramp') {
      // Under the gradients color source a ramp cell wears a named brand
      // gradient's endpoints instead of the dealt slots. Pure selection over
      // draws already made; the colors lock re-inks over it later either way.
      if (doc.colorSource === 'gradients' && !locks.colors) {
        const pool = PICKABLE_BRAND_GRADIENTS
        const brand = pool[Math.min(pool.length - 1, Math.floor(brandPick * pool.length))]
        const first = brand.stops[0]
        const last = brand.stops[brand.stops.length - 1]
        return {
          kind: 'ramp',
          from: { slot: slotA, hex: first.hex },
          to: { slot: slotB, hex: last.hex },
          angle: brand.angle,
        }
      }
      return { kind: 'ramp', from: { slot: slotA }, to: { slot: slotB }, angle: rampAngle }
    }
    return { kind: 'flat', color: { slot: slotA } }
  }
  const rowACountRoll = rng.weighted([1, 2, 3], [0.5, 0.36, 0.14])
  const rowBCountRoll = rng.weighted([1, 2, 3], [0.34, 0.46, 0.2])
  const rowACands = Array.from({ length: MAX_SECTOR_CELLS }, dealFill)
  const rowBCands = Array.from({ length: MAX_SECTOR_CELLS }, dealFill)

  // --- orb geometry + fill candidates ---
  const orbCx = rng.float(0.45, 0.55)
  const orbCy = rng.float(0.45, 0.55)
  const orbRadius = rng.float(0.5, 0.74)
  const orbGradient = remixGradient(rng, palette, doc.orb.gradient, locks.colors)
  const orbBrandPick = rng.float(0, 1)
  // Still drawn (stream unchanged), never dealt on: remix used to add the
  // orb outline 18% of the time in the palette's lightest slot — usually a
  // paper white like #EEEDE9 at 25–70% — which read as a faded edge around
  // the orb, worst on a white Figma canvas (2026-10-13). A deliberate,
  // hand-set outline is untouched: an orb section lock keeps doc.orb whole.
  rng.bool(0.18) // the old outline coin — drawn and discarded
  const strokeEnabled = false
  const strokeWidth = rng.float(1, 4)
  const strokeOpacity = rng.float(0.25, 0.7)

  // --- layer candidates, always full width ---
  const rolledLayerCount = rng.weighted([1, 2, 3], [0.3, 0.45, 0.25])
  const patternCandidates: PatternLayer[] =
    deps.available.length === 0
      ? []
      : Array.from({ length: MAX_PATTERN_LAYERS }, (_, i) =>
          remixPatternLayer(rng, deps, prevPatterns[i], locks.colors),
        )

  // The layer-existence guards stay: a document with no shading layer really
  // does consume fewer draws, because that is doc state, not lock state.
  //
  // Visibility follows the incoming layer: the v2 direction avoids rendered
  // lighting, so remix never turns shading *on* — a flat document stays flat
  // through any number of remixes, and shading returns only by explicit choice.
  const shadingCandidate: ShadingLayer | null = prevShading
    ? {
        ...remixShading(rng, palette, prevShading, locks.colors),
        visible: prevShading.visible,
      }
    : null

  // Accents have nothing to do with orb type (2026-08-25 decision): the old
  // rule that retired them under a sector collage is gone. They remix like any
  // section unless locked, and their visibility is the user's own state.
  const accentsCandidate: AccentLayer | null = prevAccents
    ? { ...remixAccents(rng, palette, prevAccents, locks.colors), visible: prevAccents.visible }
    : null

  const rolledBelow = rng.bool(0.3)

  /*
   * SELECT PHASE — pure choices between candidates and incoming values.
   * Nothing below consumes a draw.
   */

  // Pool photos need cells to live in, so a live pool steers an unlocked type
  // to segments — a selection over the draw already made, like colorSource.
  // Only photos this browser can show take part — deps state, like `available`.
  const pool = deps.photoAvailable
    ? { ...doc.photoPool, photos: doc.photoPool.photos.filter((p) => deps.photoAvailable!(p.photoId)) }
    : doc.photoPool
  const poolLive = pool.photos.length > 0 && pool.max > 0
  const orbType: OrbType =
    locks.orb || subLocks.orb.type
      ? doc.orbType
      : poolLive
        ? 'segments'
        : typeCandidate

  // --- sectors: structure, then per-cell property selection ---
  const structureLocked = structureLockedFor(doc)
  const prevSec = doc.orb.sectors
  const selAngle = structureLocked ? prevSec.angle : sectorAngle
  const selOffset = structureLocked ? prevSec.offset : sectorOffset
  // Row counts: rolled, unless the structure is locked. A pool asking for
  // more photos per orb than the rolled structure has cells grows the rows
  // (A first, alternating, up to 3 each) — pure selection; the candidates
  // were drawn at full width.
  // The cells sub-lock keeps just the counts; the chord and widths still deal.
  const countsLocked = structureLocked || subLocks.orb.cells
  let rowACount = countsLocked ? prevSec.rowA.length : rowACountRoll
  let rowBCount = countsLocked ? prevSec.rowB.length : rowBCountRoll
  if (poolLive && !countsLocked) {
    const want = Math.min(pool.min, MAX_SECTOR_CELLS * 2)
    while (rowACount + rowBCount < want) {
      if (rowACount <= rowBCount && rowACount < MAX_SECTOR_CELLS) rowACount++
      else rowBCount++
    }
  }
  // Cell widths: their own `${seed}-split` stream, drawn at full width every
  // time, so adding them moved no main-stream draw. About 40% of rows stay
  // even; the rest get relative widths in 0.55–1.6 (rowEdges floors slivers).
  const splitRng = makeRng(`${seed}-split`)
  const widthDraws = [0, 1].map(() => ({
    even: splitRng.bool(0.4),
    w: Array.from({ length: MAX_SECTOR_CELLS }, () => splitRng.float(0.55, 1.6)),
  }))
  const widthsFor = (row: 0 | 1, count: number): number[] | undefined =>
    structureLocked
      ? row === 0
        ? prevSec.widthsA
        : prevSec.widthsB
      : widthDraws[row].even || count < 2
        ? undefined
        : widthDraws[row].w.slice(0, count)

  const buildRow = (cands: SectorFill[], prevRow: SectorFill[], count: number): SectorFill[] =>
    Array.from({ length: count }, (_, i) => selectCell(cands[i % cands.length], prevRow[i]))
  let sectorRowA = buildRow(rowACands, prevSec.rowA, rowACount)
  let sectorRowB = buildRow(rowBCands, prevSec.rowB, rowBCount)
  if (locks.colors) {
    // The colors lock freezes rendered colors: reuse the incoming fills'
    // ColorRefs over the selected structure, cycling if it grew — then cells
    // whose own `color` property is locked re-assert their exact refs below.
    // Visible inks only: a texture's hidden plate (alpha 0) cycled into a
    // flat cell used to make that cell vanish. See `transplantRefs`.
    const prevRefs: ColorRef[] = [...prevSec.rowA, ...prevSec.rowB]
      .flatMap(refsOf)
      .filter((c) => (c.alpha ?? 1) > 0.001)
    if (prevRefs.length > 0) {
      let i = 0
      const takeNext = (fill: SectorFill): SectorFill => {
        const width = refsOf(fill).length
        const refs = Array.from({ length: width }, () => prevRefs[i++ % prevRefs.length])
        return transplantRefs(fill, refs)
      }
      const reassert = (fill: SectorFill, prev: SectorFill | undefined): SectorFill =>
        prev?.locks?.color ? withRefs(fill, refsOf(prev)) : fill
      sectorRowA = sectorRowA.map((f, j) => reassert(takeNext(f), prevSec.rowA[j]))
      sectorRowB = sectorRowB.map((f, j) => reassert(takeNext(f), prevSec.rowB[j]))
    }
  }

  // --- pool photos: placed into cells of the new structure ---
  // Their own RNG stream, drawn every time at full width, so the pool moves
  // no draw in the main stream: a seed deals the same composition with or
  // without photos. Cell pick k comes first so a one-photo pool keeps the
  // placements of the single kept photo it replaced.
  const photoRng = makeRng(`${seed}-photo`)
  const picks = Array.from({ length: MAX_SECTOR_CELLS * 2 }, () => ({
    cell: photoRng.float(0, 1),
    photo: photoRng.float(0, 1),
  }))
  const countPick = photoRng.float(0, 1)
  const cellAreas = sectorCellAreas(
    selOffset,
    sectorRowA.length,
    sectorRowB.length,
    widthsFor(0, sectorRowA.length),
    widthsFor(1, sectorRowB.length),
  )
  ;[sectorRowA, sectorRowB] = placePoolPhotos(pool, sectorRowA, sectorRowB, picks, countPick, cellAreas)

  const orbCandidate: Orb = {
    ...doc.orb,
    visible: doc.orb.visible,
    sectors: {
      angle: selAngle,
      offset: selOffset,
      rowA: sectorRowA,
      rowB: sectorRowB,
      widthsA: widthsFor(0, sectorRowA.length),
      widthsB: widthsFor(1, sectorRowB.length),
    },
    cx: subLocks.orb.position ? doc.orb.cx : orbCx,
    cy: subLocks.orb.position ? doc.orb.cy : orbCy,
    radius: subLocks.orb.size ? doc.orb.radius : orbRadius,
    gradient: selectGradient(orbGradient, orbBrandPick, doc, palette, locks.colors),
    stroke: {
      ...doc.orb.stroke,
      enabled: strokeEnabled,
      width: strokeWidth,
      color: locks.colors ? doc.orb.stroke.color : { slot: deck.light[0] },
      opacity: strokeOpacity,
    },
  }

  const backgroundCandidate: Background = {
    kind: bgKind,
    color: locks.colors ? doc.background.color : { slot: deck.dark[0] },
    gradient: selectGradient(
      {
        ...bgGradient,
        type: bgRadial ? 'radial' : 'linear',
        stops: locks.colors ? doc.background.gradient.stops : bgStops,
        radius: bgRadius,
      },
      bgBrandPick,
      doc,
      palette,
      locks.colors,
    ),
    vignette: bgVignette,
  }

  // --- pattern layers: count, then per-layer property selection ---
  const countLocked = patternCountLockedFor(doc)
  const layerCount =
    deps.available.length === 0
      ? 0
      : countLocked
        ? prevPatterns.length
        : orbType === 'pattern'
          ? Math.min(2, Math.max(1, rolledLayerCount))
          : rolledLayerCount
  const patterns = patternCandidates.slice(0, layerCount).map((cand, i) => {
    const selected = selectLayer(cand, prevPatterns[i], deps)
    // A Color or Segments orb carries itself; its pattern layers stay in the
    // document but render hidden, so switching type back restores them.
    return { ...selected, visible: orbType === 'pattern' && i < 2 }
  })

  // --- apply the section locks ---
  const background = locks.background ? doc.background : backgroundCandidate
  const orb = locks.orb ? doc.orb : orbCandidate
  const selectedPatterns = locks.patterns ? prevPatterns : patterns
  const shading = locks.shading ? (prevShading ?? null) : shadingCandidate
  const accents = locks.accents ? (prevAccents ?? null) : accentsCandidate

  /*
   * --- stack order ---
   *
   * A locked section's layers keep their **exact positions**, not just their
   * contents. Positions may only move for unlocked sections. So this substitutes
   * remixed layers into the slots they already occupy rather than rebuilding the
   * array in a canonical order — the old rebuild flattened any arrangement a user
   * had made (shading between two patterns, an accent mid-stack) on every Remix,
   * even with those sections locked.
   *
   * The accent above/below roll is still drawn unconditionally, per the RNG
   * invariant; it may only *move* the accent when accents are unlocked.
   */
  let patternSlot = 0
  let shadingPlaced = false
  let accentPlaced = false
  // A null marks a pattern slot the new, shorter run no longer fills.
  const substituted: (Layer | null)[] = doc.layers.map((layer) => {
    if (layer.kind === 'pattern') return selectedPatterns[patternSlot++] ?? null
    if (layer.kind === 'shading') {
      // Only the first shading layer was remixed; any duplicates pass through.
      if (shadingPlaced || !shading) return layer
      shadingPlaced = true
      return shading
    }
    if (accentPlaced || !accents) return layer
    accentPlaced = true
    return accents
  })
  const layers: Layer[] = substituted.filter((l): l is Layer => l !== null)

  // A longer pattern run needs somewhere to put the surplus: straight after the
  // last existing pattern slot, else below the shading layer, else at the end.
  const surplus = selectedPatterns.slice(patternSlot)
  if (surplus.length > 0) {
    let at = -1
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].kind === 'pattern') {
        at = i + 1
        break
      }
    }
    if (at < 0) {
      const shadingAt = layers.findIndex((l) => l.kind === 'shading')
      at = shadingAt >= 0 ? shadingAt : layers.length
    }
    layers.splice(at, 0, ...surplus)
  }

  // Move only the accent layer, only when unlocked, leaving every other layer's
  // relative order alone.
  if (!locks.accents) {
    const at = layers.findIndex((l) => l.kind === 'accent')
    if (at >= 0) {
      const [moved] = layers.splice(at, 1)
      if (rolledBelow) layers.unshift(moved)
      else layers.push(moved)
    }
  }

  return { ...doc, seed, orbType, background, orb, layers }
}

/**
 * Randomize one section and leave everything else alone — the inverse of the
 * locks, implemented by inverting them so there is only one code path deciding
 * what a section's randomization means.
 *
 * Sub-locks and per-object property locks pass through **unchanged**: a
 * sub-lock is absolute even against its own section's dice.
 *
 * `doc.seed` is deliberately left untouched. The header seed reproduces a *full*
 * remix; a partial one is an edit, the same as moving a slider, and claiming
 * otherwise would make the seed a lie.
 */
export function remixSection(
  doc: OrbDoc,
  section: Exclude<LockSection, 'colors'>,
  seed: string,
  deps: RemixDeps,
): OrbDoc {
  if (doc.locks[section]) return doc // the lock wins
  const inverted: Locks = {
    colors: true,
    background: true,
    orb: true,
    patterns: true,
    shading: true,
    accents: true,
    [section]: false,
  }
  const out = remix({ ...doc, locks: inverted }, seed, deps)
  return { ...out, locks: doc.locks, seed: doc.seed }
}

/**
 * Re-deal palette slots without touching a single geometric value.
 * Respects the `colors` lock (a no-op while colors are frozen) and every
 * per-object `color` property lock — those layers and cells keep their refs,
 * while their pools are still drawn so the stream never depends on a lock.
 */
export function shuffleColors(doc: OrbDoc, palette: Palette, seed: string): OrbDoc {
  if (doc.locks.colors) return doc // the lock wins
  const rng = makeRng(seed)
  const deck = buildDeck(palette)

  const rampFor = (stops: GradientStop[], darkBias: boolean): GradientStop[] => {
    const slots = darkBias
      ? rng.shuffle(deck.dark).concat(rng.shuffle(deck.mid))
      : dealRamp(rng, palette, stops.length)
    return stops.map((s, i) => ({ ...s, color: { ...s.color, slot: slots[i % slots.length] } }))
  }

  const background = {
    ...doc.background,
    color: { ...doc.background.color, slot: deck.dark[0] },
    gradient: {
      ...doc.background.gradient,
      stops: rampFor(doc.background.gradient.stops, true),
    },
  }

  const orb = {
    ...doc.orb,
    gradient: { ...doc.orb.gradient, stops: rampFor(doc.orb.gradient.stops, false) },
    stroke: { ...doc.orb.stroke, color: { ...doc.orb.stroke.color, slot: deck.light[0] } },
  }

  const layers: Layer[] = doc.layers.map((layer) => {
    if (layer.kind === 'pattern') {
      const pool =
        layer.blend === 'multiply'
          ? deck.dark
          : layer.blend === 'normal'
            ? deck.all
            : deck.light
      const shuffled = rng.shuffle(pool.length ? pool : deck.all)
      let i = 0
      const dealt = layer.colors.map((c) =>
        (c.alpha ?? 1) <= 0.001
          ? c // a hidden plate stays hidden
          : { ...c, slot: shuffled[i++ % shuffled.length], hex: null },
      )
      // Drawn either way; a color-locked layer keeps its refs.
      return layer.locks?.color ? layer : { ...layer, colors: dealt }
    }
    if (layer.kind === 'shading') {
      return {
        ...layer,
        shadowColor: { ...layer.shadowColor, slot: deck.dark[0], hex: null },
        highlightColor: { ...layer.highlightColor, slot: deck.light[0], hex: null },
      }
    }
    const accentPool = rng.shuffle([...deck.light, ...deck.mid])
    let j = 0
    return {
      ...layer,
      rings: layer.rings.map((ring) => ({
        ...ring,
        color: { ...ring.color, slot: accentPool[j++ % accentPool.length], hex: null },
      })),
      satellites: layer.satellites.map((sat) => ({
        ...sat,
        color: { ...sat.color, slot: accentPool[j++ % accentPool.length], hex: null },
      })),
      rim: {
        ...layer.rim,
        color: { ...layer.rim.color, slot: deck.light[0], hex: null },
      },
    }
  })

  // Sector fills are ColorRefs too, so the shuffle has to reach them — an orb
  // in segments mode would otherwise look immune to Shuffle colors. Drawn after
  // every existing draw, so pre-sector documents shuffle exactly as before.
  const sectorPool = rng.shuffle(deck.all)
  let k = 0
  const nextSlot = () => sectorPool[k++ % sectorPool.length]
  // A flat cell is all area: walk past paper slots (selection only — the
  // shuffle above is the one draw), as remix's dealing does.
  const nextAreaSlot = () => {
    for (let tries = 0; tries < sectorPool.length; tries++) {
      const s = nextSlot()
      if (!deck.paper.has(s)) return s
    }
    return nextSlot()
  }
  const shuffleFill = (f: SectorFill): SectorFill => {
    const dealt: SectorFill = (() => {
      if (f.kind === 'photo') return f
      if (f.kind === 'flat') return { ...f, color: { ...f.color, slot: nextAreaSlot(), hex: null } }
      if (f.kind === 'ramp')
        return {
          ...f,
          from: { ...f.from, slot: nextSlot(), hex: null },
          to: { ...f.to, slot: nextSlot(), hex: null },
        }
      return {
        ...f,
        colors: f.colors.map((c) =>
          // A hidden plate stays hidden, same as pattern layers.
          (c.alpha ?? 1) <= 0.001 ? c : { ...c, slot: nextSlot(), hex: null },
        ),
      }
    })()
    // Draws consumed above either way; a color-locked cell keeps its refs.
    return f.locks?.color ? f : dealt
  }
  const sectors = {
    ...orb.sectors,
    rowA: orb.sectors.rowA.map(shuffleFill),
    rowB: orb.sectors.rowB.map(shuffleFill),
  }

  return { ...doc, background, orb: { ...orb, sectors }, layers }
}
