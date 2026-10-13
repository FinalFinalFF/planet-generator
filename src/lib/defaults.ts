import {
  DEFAULT_SUBLOCKS,
  DOC_VERSION,
  type AccentLayer,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type Layer,
  type LayerMask,
  type LockSection,
  type Locks,
  type MaskMode,
  type PatternLayer,
  type Orb,
  type OrbDoc,
  type OrbType,
  type PhotoPool,
  type PoolPhoto,
  type SectorConfig,
  type ShadingLayer,
  type SubLocks,
} from '../types'
import { BUILTIN_PALETTES } from './palettes'
import type { ParsedPattern } from './patterns/parse'
import type { Palette } from '../types'
import { luminance } from './color'

let uid = 0
export function nextId(prefix: string): string {
  uid += 1
  return `${prefix}${Date.now().toString(36).slice(-4)}${uid.toString(36)}`
}

export function ref(slot: number, alpha = 1): ColorRef {
  return alpha === 1 ? { slot } : { slot, alpha }
}

export function gradient(partial: Partial<Gradient> & { stops: Gradient['stops'] }): Gradient {
  return {
    type: 'linear',
    angle: 120,
    focusX: 0.5,
    focusY: 0.5,
    radius: 0.75,
    segments: 180,
    ...partial,
  }
}

export function stop(offset: number, slot: number, alpha = 1) {
  return { id: nextId('s'), offset, color: ref(slot, alpha) }
}

export const DEFAULT_LAYER_MASK: LayerMask = {
  mode: 'orb',
  cx: 0.22,
  cy: -0.18,
  radius: 0.85,
  feather: 0,
}

/**
 * The default sector collage reads like the 2026-08-25 comps: a light ramp
 * across the top half, the bottom split into a dark cell and a mid accent.
 */
export const DEFAULT_SECTORS: SectorConfig = {
  angle: 0,
  offset: 0,
  rowA: [{ kind: 'ramp', from: ref(5), to: ref(7), angle: 64 }],
  rowB: [
    { kind: 'flat', color: ref(0) },
    { kind: 'flat', color: ref(3) },
  ],
}

/**
 * Sector configs hold arrays of fill objects, so a spread is not enough —
 * two documents sharing one row array would alias each other's cells.
 */
export function cloneSectors(s: SectorConfig): SectorConfig {
  return {
    ...s,
    rowA: s.rowA.map((f) => ({ ...f })),
    rowB: s.rowB.map((f) => ({ ...f })),
    widthsA: s.widthsA ? [...s.widthsA] : undefined,
    widthsB: s.widthsB ? [...s.widthsB] : undefined,
  }
}

/* ---------- pattern layer color defaults ---------- */

/**
 * Sensible palette-slot assignment for a freshly added pattern layer.
 * The plate is hidden so the pattern reads as texture over the orb, and ink
 * groups get light or dark slots depending on how the layer will blend.
 */
export function defaultPatternColors(
  parsed: ParsedPattern,
  palette: Palette,
  blend: BlendMode,
): ColorRef[] {
  const byLight = palette.colors
    .map((c, i) => ({ i, L: luminance(c) }))
    .sort((a, b) => a.L - b.L)
    .map((x) => x.i)
  const darkPool = byLight.slice(0, Math.max(1, Math.ceil(byLight.length / 2)))
  const lightPool = byLight.slice(Math.floor(byLight.length / 2)).reverse()
  const pool = blend === 'multiply' ? darkPool : blend === 'normal' ? byLight.slice().reverse() : lightPool

  const inks = parsed.groups.filter((g) => !g.isBackground).sort((a, b) => a.meanL - b.meanL)
  const assignment = new Map<number, number>()
  inks.forEach((g, i) => assignment.set(g.index, pool[i % pool.length]))

  return parsed.groups.map((g) => {
    if (g.isBackground) return { slot: byLight[0], alpha: 0 }
    return { slot: assignment.get(g.index) ?? pool[0], alpha: 1 }
  })
}

export function makePatternLayer(
  parsed: ParsedPattern,
  palette: Palette,
  overrides: Partial<PatternLayer> = {},
): PatternLayer {
  const blend: BlendMode = overrides.blend ?? 'normal'
  return {
    kind: 'pattern',
    id: nextId('pl'),
    name: parsed.name,
    visible: true,
    patternId: parsed.id,
    fit: 'tile',
    scale: 1.2,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    opacity: 0.55,
    colors: defaultPatternColors(parsed, palette, blend),
    mask: { ...DEFAULT_LAYER_MASK },
    ...overrides,
    blend,
  }
}

export function makeShadingLayer(overrides: Partial<ShadingLayer> = {}): ShadingLayer {
  return {
    kind: 'shading',
    id: nextId('sh'),
    name: 'Sphere shading',
    visible: true,
    // Tuned to read as a sphere rather than a flat circle: a strong terminator
    // does most of the work, limb darkening seats the edge, and the highlight
    // stays tight enough to imply curvature instead of washing the disc out.
    shadow: 0.86,
    highlight: 0.34,
    lightAngle: 306,
    lightDistance: 0.5,
    highlightSize: 0.72,
    contactShadow: 0.55,
    shadowColor: { slot: 0 },
    highlightColor: { slot: 7 },
    blend: 'normal',
    opacity: 1,
    ...overrides,
  }
}

export function makeAccentLayer(overrides: Partial<AccentLayer> = {}): AccentLayer {
  return {
    kind: 'accent',
    id: nextId('ac'),
    name: 'Accents',
    visible: true,
    rings: [
      {
        id: nextId('r'),
        radius: 1.24,
        start: 196,
        sweep: 232,
        width: 2.5,
        color: ref(3),
        opacity: 0.55,
        tilt: 0.34,
        rotation: -18,
        dash: 0,
      },
    ],
    satellites: [
      {
        id: nextId('sa'),
        angle: 46,
        distance: 1.42,
        size: 0.055,
        color: ref(6),
        opacity: 0.9,
        strokeWidth: 0,
      },
    ],
    rim: {
      // Off by default — the crescent is a lighting cue, and v2 avoids those.
      // The tuned values stay so enabling it lands somewhere sensible.
      enabled: false,
      angle: 306,
      width: 0.016,
      spread: 0.3,
      color: ref(7),
      opacity: 0.5,
      blend: 'screen',
    },
    ...overrides,
  }
}

/* ---------- the default document ---------- */

const DEFAULT_PATTERN_A = 'geometry-grid-patterns-2' // rounded-square lattice
const DEFAULT_PATTERN_B = 'geometry-grid-patterns-4' // dot halftone

/**
 * First-load composition: an ember/teal sweep on near-black, textured with a
 * halftone and a voronoi wash, seated with sphere shading and a tilted orbit.
 * Pattern layer colors are filled in once the pattern files have parsed.
 */
export function defaultDoc(seed: string): OrbDoc {
  const layers: Layer[] = [
    {
      // Crisp ink over the gradient, the way the reference discs read —
      // `normal` blend at high opacity rather than a soft-light wash.
      kind: 'pattern',
      id: 'pl-default-a',
      name: 'Grid lattice',
      visible: true,
      patternId: DEFAULT_PATTERN_A,
      fit: 'tile',
      scale: 1.5,
      rotation: 0,
      offsetX: -0.04,
      offsetY: 0.02,
      opacity: 0.5,
      blend: 'normal',
      colors: [
        { slot: 0, alpha: 0 },
        { slot: 0, alpha: 1 },
      ],
      mask: { ...DEFAULT_LAYER_MASK },
    },
    {
      // A halftone patch confined to a soft lens, the way the reference's
      // circles show texture only where they overlap.
      kind: 'pattern',
      id: 'pl-default-b',
      name: 'Halftone patch',
      visible: true,
      patternId: DEFAULT_PATTERN_B,
      fit: 'tile',
      scale: 0.42,
      rotation: 12,
      offsetX: 0.06,
      offsetY: -0.02,
      opacity: 0.34,
      blend: 'multiply',
      colors: [
        { slot: 0, alpha: 0 },
        { slot: 1, alpha: 1 },
      ],
      mask: { mode: 'lens', cx: 0.28, cy: 0.24, radius: 0.92, feather: 0.45 },
    },
    // v2 opens flat-graphic: the layers exist with tuned values so the
    // shaded-sphere style and the layer toggles can bring them back, but
    // nothing renders as lighting until someone asks for it.
    makeShadingLayer({ id: 'sh-default', visible: false }),
    makeAccentLayer({ id: 'ac-default' }),
  ]

  return {
    version: DOC_VERSION,
    seed,
    canvas: { width: 1600, height: 1600 },
    paletteId: BUILTIN_PALETTES[0].id,
    // Two pattern layers ship visible, so the default document is the
    // `pattern` type by its own definition.
    orbType: 'pattern',
    colorSource: 'palette',
    background: {
      kind: 'gradient',
      color: { slot: 0 },
      gradient: gradient({
        type: 'radial',
        focusX: 0.42,
        focusY: 0.38,
        radius: 0.95,
        stops: [stop(0, 1), stop(0.55, 0), stop(1, 0)],
      }),
      vignette: 0.35,
    },
    orb: {
      visible: true,
      cx: 0.5,
      cy: 0.5,
      radius: 0.62,
      sectors: cloneSectors(DEFAULT_SECTORS),
      // The ember→cream→teal ramp from the reference, read left to right.
      // Linear rather than conic on purpose: a conic's convergence point
      // reads as a pinwheel pinch when it lands on the disc.
      gradient: gradient({
        type: 'linear',
        angle: 104,
        stops: [
          stop(0, 1),
          stop(0.13, 4),
          stop(0.32, 5),
          stop(0.5, 6),
          stop(0.63, 7),
          stop(0.79, 3),
          stop(0.92, 2),
          stop(1, 1),
        ],
      }),
      stroke: { enabled: false, width: 2, color: { slot: 7 }, opacity: 0.4 },
    },
    layers,
    flat: false,
    solidFills: false,
    photoPool: { photos: [], min: 1, max: 1 },
    locks: {
      colors: false,
      orb: false,
      patterns: false,
      shading: false,
      accents: false,
      background: false,
    },
    subLocks: structuredClone(DEFAULT_SUBLOCKS),
  }
}

export const DEFAULT_PATTERN_IDS = [DEFAULT_PATTERN_A, DEFAULT_PATTERN_B]

/* ---------- migration ---------- */

/**
 * The pre-v4 shape: `planet` (v2 and earlier) or `orb` with a `mode` of
 * disc/sliced/sectors and a `slices` config, plus `lockPatternCount` at the
 * doc level. Presets store whole documents and the working document is
 * persisted, so these field names are still sitting in real users'
 * localStorage and have to keep loading.
 */
type LegacyOrb = Orb & {
  mode?: 'disc' | 'sliced' | 'sectors'
  slices?: unknown
}
type LegacyDoc = Omit<
  OrbDoc,
  'orb' | 'locks' | 'orbType' | 'subLocks' | 'colorSource' | 'photoPool'
> & {
  photoPool?: Partial<PhotoPool>
  /** The single kept photo, before the pool (2026-10-13); becomes a one-photo pool. */
  featuredPhoto?: PoolPhoto | null
  orb?: LegacyOrb
  planet?: LegacyOrb
  orbType?: OrbType
  subLocks?: Partial<SubLocks>
  colorSource?: OrbDoc['colorSource']
  lockPatternCount?: boolean
  locks: Partial<Record<LockSection | 'planet', boolean>>
}

/**
 * Fill in anything a document saved by an older version is missing. Presets
 * store whole documents, so a v1 preset has to keep loading.
 *
 * v4 is the one migration that *changes a document's look*: `sliced` is
 * retired, so a sliced document comes back as a `color` disc wearing the same
 * gradient its slice ramp sampled. Deliberate (2026-08-25 decision), and
 * called out in the release note rather than silently absorbed.
 */
const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback

/** Photos per orb never exceed the cells a structure can have (two rows of 3). */
export const MAX_PHOTOS_PER_ORB = 6

function normalizePhotoPool(
  pool: Partial<PhotoPool> | undefined,
  legacy: PoolPhoto | null | undefined,
): PhotoPool {
  const photos = (pool?.photos ?? (legacy?.photoId ? [legacy] : []))
    .filter((p) => p && typeof p.photoId === 'string' && p.photoId)
    .map((p) => ({
      photoId: p.photoId,
      zoom: Math.max(1, Math.min(8, Number(p.zoom) || 1)),
      focusX: Math.max(0, Math.min(1, Number.isFinite(p.focusX) ? p.focusX : 0.5)),
      focusY: Math.max(0, Math.min(1, Number.isFinite(p.focusY) ? p.focusY : 0.5)),
    }))
  const min = clampInt(pool?.min, 0, MAX_PHOTOS_PER_ORB, 1)
  const max = Math.max(min, clampInt(pool?.max, 0, MAX_PHOTOS_PER_ORB, Math.max(1, min)))
  return { photos, min, max }
}

export function normalizeDoc(input: OrbDoc): OrbDoc {
  // v2 and earlier called this `planet`. Renaming the field rather than aliasing
  // it keeps one name in the model; the cost is this migration.
  const doc = input as unknown as LegacyDoc
  const base = doc.orb ?? doc.planet
  if (!base) throw new Error('document has neither `orb` nor legacy `planet`')

  const layers = doc.layers.map((layer) =>
    layer.kind === 'pattern'
      ? {
          ...layer,
          mask: {
            ...DEFAULT_LAYER_MASK,
            ...(layer.mask ?? {}),
            // The mask mode was a string literal, so it migrates too.
            mode: ((layer.mask?.mode as string) === 'planet'
              ? 'orb'
              : (layer.mask?.mode ?? DEFAULT_LAYER_MASK.mode)) as MaskMode,
          },
        }
      : layer,
  )

  // v4: the type is derived from what the document *is*. Sliced retires to
  // `color` (the gradient survives; the lattice does not).
  const orbType: OrbType =
    doc.orbType ??
    (base.mode === 'sectors'
      ? 'segments'
      : base.mode === 'sliced'
        ? 'color' // sliced retires; the gradient survives, the lattice does not
        : layers.some((l) => l.kind === 'pattern' && l.visible)
          ? 'pattern'
          : 'color')

  const orb: Orb = {
    visible: base.visible ?? true,
    cx: base.cx,
    cy: base.cy,
    radius: base.radius,
    gradient: base.gradient,
    sectors: { ...cloneSectors(DEFAULT_SECTORS), ...(base.sectors ?? {}) },
    stroke: base.stroke,
  }

  // Structural merge, so a sub-lock added later defaults cleanly too.
  const subLocks: SubLocks = {
    orb: { ...DEFAULT_SUBLOCKS.orb, ...(doc.subLocks?.orb ?? {}) },
    patterns: { ...DEFAULT_SUBLOCKS.patterns, ...(doc.subLocks?.patterns ?? {}) },
    colors: { ...DEFAULT_SUBLOCKS.colors, ...(doc.subLocks?.colors ?? {}) },
  }
  // Absorb the legacy field, then delete it so the two never coexist.
  if (typeof doc.lockPatternCount === 'boolean') {
    subLocks.patterns.count ||= doc.lockPatternCount
  }

  const { planet: legacyPlanetLock, ...locks } = doc.locks ?? {}
  const out = {
    ...doc,
    version: DOC_VERSION,
    orbType,
    orb,
    layers,
    locks: { ...locks, orb: locks.orb ?? legacyPlanetLock ?? false } as Locks,
    subLocks,
    colorSource: doc.colorSource ?? 'palette',
    flat: doc.flat ?? false,
    solidFills: doc.solidFills ?? false,
    photoPool: normalizePhotoPool(doc.photoPool, doc.featuredPhoto),
  }
  delete (out as { planet?: unknown }).planet
  delete (out as { featuredPhoto?: unknown }).featuredPhoto
  delete (out as { lockPatternCount?: unknown }).lockPatternCount
  return out as OrbDoc
}

/* ---------- orb type switching ---------- */

/**
 * Switch the orb type — the engine behind the Type segmented control.
 *
 * Rewrites `orbType` and pattern-layer *visibility* together (a Color or
 * Segments orb hides its pattern layers; a Pattern orb shows the first two),
 * and touches nothing else: shading and accents are orthogonal to type
 * (2026-08-25 decision — accents have nothing to do with orb type), palette,
 * geometry, seed and locks are left alone, and hidden layers keep their data
 * so switching back restores them.
 *
 * **The type change itself is never blocked** — the Type control is the
 * user's own hand, and locks guard randomizers and macros, never hand-edits
 * (a type sub-lock pins the *new* value against the next remix). Only the
 * pattern-visibility side effect defers to `locks.patterns`, since that
 * writes into another section; it is reported so the UI can say so.
 */
export type OrbTypeResult = {
  doc: OrbDoc
  /** What a lock kept the switch from touching, for the caller to report. */
  skipped: 'patterns'[]
}

export function applyOrbType(doc: OrbDoc, type: OrbType): OrbTypeResult {
  const skipped: OrbTypeResult['skipped'] = []
  const nextType = type

  let layers = doc.layers
  const hasPattern = doc.layers.some((l) => l.kind === 'pattern')
  if (doc.locks.patterns) {
    if (hasPattern) skipped.push('patterns')
  } else {
    let i = 0
    layers = doc.layers.map((l) =>
      l.kind === 'pattern' ? { ...l, visible: nextType === 'pattern' && i++ < 2 } : l,
    )
  }

  return { doc: { ...doc, orbType: nextType, layers }, skipped }
}
