/** The orb document model. Everything the renderer needs, and nothing else. */

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const
export type BlendMode = (typeof BLEND_MODES)[number]

export const GRADIENT_TYPES = ['linear', 'radial', 'conic'] as const
export type GradientType = (typeof GRADIENT_TYPES)[number]

/**
 * A color reference. `slot` indexes into the active palette; `hex` is a
 * per-element override that wins when set. `alpha` is applied on top of both.
 */
export type ColorRef = {
  slot: number
  hex?: string | null
  alpha?: number
}

export type GradientStop = {
  id: string
  offset: number // 0..1
  color: ColorRef
}

export type Gradient = {
  type: GradientType
  /** Degrees, clockwise from 12 o'clock. Used by linear and conic. */
  angle: number
  stops: GradientStop[]
  /** Radial focus, in units of the orb's bounding box (0..1). */
  focusX: number
  focusY: number
  /** Radial radius as a fraction of the bounding box. */
  radius: number
  /** Conic segment count — how finely the sweep is approximated in SVG. */
  segments: number
}

export type BackgroundKind = 'solid' | 'gradient' | 'transparent'

export type Background = {
  kind: BackgroundKind
  color: ColorRef
  gradient: Gradient
  /** 0..1 corner darkening, sold separately from the fill. */
  vignette: number
}

export type PatternFit = 'tile' | 'cover'

export const MASK_MODES = ['orb', 'lens', 'outside-lens'] as const
/**
 * Where a pattern layer is allowed to paint inside the orb.
 * `lens` is the intersection with an offset circle, `outside-lens` its
 * complement — the lens-shaped pattern patches in the reference come from these.
 */
export type MaskMode = (typeof MASK_MODES)[number]

export type LayerMask = {
  mode: MaskMode
  /** Lens center offset from the orb center, in orb diameters. */
  cx: number
  cy: number
  /** Lens radius as a fraction of the orb radius. */
  radius: number
  /** 0 = hard edge; higher values fade the lens edge out over that fraction. */
  feather: number
}

/**
 * Per-property locks on an object (a pattern layer or a segment cell). Absent
 * or false = unlocked. The vocabulary is deliberately short and user-meaningful
 * ("lock this layer's pattern"), not one flag per field — the object-level and
 * section-level locks cover the rest.
 *
 * Semantics are uniform with every other lock: a property lock freezes the
 * value against randomizers and macros (remix, dice, shuffle, type switches),
 * never against the user's own hand, and never the palette indirection.
 *
 * **Existence implication** (see `remix.ts`): any property lock on a layer
 * implies the pattern-layer *count* behaves locked, and any lock on a segment
 * cell implies the sector *structure* (chord + row counts) behaves locked —
 * a lock on a child implies the lock that guarantees the child's existence.
 * Implications are derived at remix time, never stored.
 */
export type PropertyLocks<K extends string> = Partial<Record<K, boolean>>

export type LayerPropertyLock = 'pattern' | 'color' | 'scale' | 'position' | 'rotation'
export type CellPropertyLock = 'fill' | 'color' | 'scale' | 'rotation'

export type PatternLayer = {
  kind: 'pattern'
  id: string
  name: string
  visible: boolean
  patternId: string
  fit: PatternFit
  /** 1 = tile spans `TILE_BASE_FRACTION` of the orb diameter. */
  scale: number
  rotation: number
  /** Offsets in orb diameters. */
  offsetX: number
  offsetY: number
  opacity: number
  blend: BlendMode
  /** One entry per color group of the referenced pattern. */
  colors: ColorRef[]
  mask: LayerMask
  locks?: PropertyLocks<LayerPropertyLock>
}

export type ShadingLayer = {
  kind: 'shading'
  id: string
  name: string
  visible: boolean
  /** 0..1 strength of the terminator shadow. */
  shadow: number
  /** 0..1 strength of the specular/ambient highlight. */
  highlight: number
  /** Degrees, clockwise from 12 o'clock — where the light comes from. */
  lightAngle: number
  /** How far the light sits from center, in orb radii. */
  lightDistance: number
  /** Highlight size as a fraction of the orb radius. */
  highlightSize: number
  /** 0..1 inner rim darkening that seats the sphere. */
  contactShadow: number
  shadowColor: ColorRef
  highlightColor: ColorRef
  blend: BlendMode
  opacity: number
}

export type RingConfig = {
  id: string
  /** Radius as a fraction of the orb radius (>1 orbits outside). */
  radius: number
  /** Start angle and sweep in degrees. */
  start: number
  sweep: number
  width: number
  color: ColorRef
  opacity: number
  /** Minor:major axis ratio. 1 = circle, lower values tilt the orbit. */
  tilt: number
  /** Rotation of the ellipse itself, in degrees. */
  rotation: number
  /** 0 = solid; otherwise dash length in px. */
  dash: number
}

export type SatelliteConfig = {
  id: string
  /** Position in polar coords around the orb center. */
  angle: number
  distance: number
  /** Radius as a fraction of the orb radius. */
  size: number
  color: ColorRef
  opacity: number
  /** When set, the satellite is a ring rather than a disc. */
  strokeWidth: number
}

export type AccentLayer = {
  kind: 'accent'
  id: string
  name: string
  visible: boolean
  rings: RingConfig[]
  satellites: SatelliteConfig[]
  /** Crescent rim light along the lit limb. */
  rim: {
    enabled: boolean
    angle: number
    width: number
    spread: number
    color: ColorRef
    opacity: number
    blend: BlendMode
  }
}

export type Layer = PatternLayer | ShadingLayer | AccentLayer
export type LayerKind = Layer['kind']

/**
 * The orb's type — the workflow's first choice, and what the editor's panels
 * key off. `color` is a flat-or-gradient disc; `pattern` is a base fill with
 * 1–2 pattern layers over it; `segments` is the chord-split collage.
 *
 * The old `sliced` render mode is retired (2026-08-25 decision): no type chip,
 * no remix dealing. `normalizeDoc` migrates sliced documents to `color`,
 * keeping their gradient — their banded lattice is gone, called out in the
 * release note.
 */
export const ORB_TYPES = ['color', 'pattern', 'segments'] as const
export type OrbType = (typeof ORB_TYPES)[number]

export const ORB_TYPE_LABELS: Record<OrbType, string> = {
  color: 'Color',
  pattern: 'Pattern',
  segments: 'Segments',
}

export const SECTOR_FILL_KINDS = ['flat', 'ramp', 'texture'] as const
export type SectorFillKind = (typeof SECTOR_FILL_KINDS)[number]

/**
 * One sector cell's paint. `flat` is a single ink; `ramp` is a two-stop linear
 * gradient spanning the orb's bounding box rather than the cell, so adjacent
 * ramp cells read as parts of one composition instead of restarting at every
 * seam. `texture` fills the cell with any registered pattern (the procedural
 * textures, the built-in library, or an import), cover-fit and recolored
 * through the same parse pipeline as pattern layers — `colors` has one entry
 * per color group of the referenced pattern, exactly like `PatternLayer`.
 */
export type SectorFill =
  | { kind: 'flat'; color: ColorRef; locks?: PropertyLocks<CellPropertyLock> }
  | { kind: 'ramp'; from: ColorRef; to: ColorRef; angle: number; locks?: PropertyLocks<CellPropertyLock> }
  | {
      kind: 'texture'
      patternId: string
      colors: ColorRef[]
      scale: number
      rotation: number
      locks?: PropertyLocks<CellPropertyLock>
    }

/**
 * The sector collage from the 2026-08-25 references: the disc cut by one
 * straight chord into two rows, each row cut crosswise into 1–3 cells, every
 * cell filled independently with a hard edge — a collage of textures, not a
 * shaded sphere.
 *
 * Cell geometry is derived, matching the slices' philosophy: cells split a
 * row's width evenly, and only the chord's angle and offset are authored.
 * There is deliberately no per-cell geometry control and no feathering —
 * hard seams are the look.
 */
export type SectorConfig = {
  /** Rotation of the whole split structure, degrees clockwise. 0 = horizontal chord. */
  angle: number
  /** Chord offset from the orb center along its normal, in orb radii. */
  offset: number
  /** Fills for the two rows' cells (1–3 each). At angle 0, row A is on top. */
  rowA: SectorFill[]
  rowB: SectorFill[]
}

export type Orb = {
  visible: boolean
  /** Center as a fraction of canvas width/height. */
  cx: number
  cy: number
  /** Radius as a fraction of min(width, height) / 2. */
  radius: number
  /** The disc fill for the `color` type and the base fill under `pattern`. */
  gradient: Gradient
  /** Sector-collage cells; only rendered when `doc.orbType` is `segments`. */
  sectors: SectorConfig
  stroke: {
    enabled: boolean
    width: number
    color: ColorRef
    opacity: number
  }
}

export type Canvas = {
  width: number
  height: number
}

export type Palette = {
  id: string
  name: string
  colors: string[]
  /** Built-ins can be duplicated but not edited in place. */
  builtin?: boolean
}

export const LOCK_SECTIONS = ['colors', 'orb', 'patterns', 'shading', 'accents', 'background'] as const
export type LockSection = (typeof LOCK_SECTIONS)[number]
export type Locks = Record<LockSection, boolean>

/**
 * Property-level sub-locks — the middle tier of the lock tree between a
 * section lock and the per-object `locks` on layers and cells. Each freezes
 * one user-meaningful property while the rest of its section keeps remixing:
 *
 * - `orb.type`      the orb type only; a type locked to `segments` still
 *                   re-deals its cells.
 * - `orb.size`      the radius.
 * - `orb.position`  cx + cy as one unit.
 * - `orb.structure` segments only: the chord (angle + offset) and both row
 *                   counts — "this many segments, keep dealing what's inside".
 * - `patterns.count` how many pattern layers a remix produces (absorbs the
 *                   old `doc.lockPatternCount`).
 * - `colors.palette` keep the palette on Remix All, still re-deal assignments.
 *
 * A section lock ⊇ its sub-locks: with the section locked the sub-locks are
 * moot; stored state is independent so toggling the section lock returns you
 * to exactly the sub-locks you had. Like `Locks`, deliberately shallow and
 * fully typed so `normalizeDoc` can default it structurally.
 */
export type SubLocks = {
  orb: { type: boolean; size: boolean; position: boolean; structure: boolean }
  patterns: { count: boolean }
  colors: { palette: boolean }
}

export const DEFAULT_SUBLOCKS: SubLocks = {
  orb: { type: false, size: false, position: false, structure: false },
  patterns: { count: false },
  colors: { palette: false },
}

export type OrbDoc = {
  version: number
  seed: string
  canvas: Canvas
  paletteId: string
  background: Background
  /** The workflow's first choice; drives the editor panels and remix dealing. */
  orbType: OrbType
  orb: Orb
  layers: Layer[]
  locks: Locks
  subLocks: SubLocks
  /**
   * Where remix gets its color from: `palette` deals slot ramps (the default),
   * `gradients` selects one of the named RSAC brand gradients instead at every
   * smooth-gradient site. A standing preference like `flat` — survives remix
   * via the spread, not a lock, not in `doc.locks`.
   */
  colorSource: 'palette' | 'gradients'
  /**
   * Suppress every cue that reads as a 3D sphere, keeping everything that is
   * genuinely graphic.
   *
   * A **standing constraint**, not a one-shot macro like the `flat-disc`
   * composition style: it coexists with any style and survives any remix, and it
   * outranks both at render time. Suppressed: the shading layer entirely, and the
   * accent layer's crescent rim light. Kept: gradients of every type, patterns,
   * rings, satellites, background, vignette.
   *
   * Deliberately **not** in `doc.locks` — a lock freezes a section's values
   * against randomization, whereas this changes what renders while leaving the
   * values alone. Suppression is render-side only (see `OrbSvg`), so toggling
   * it off restores the user's shading and rim settings exactly.
   */
  flat: boolean
  /**
   * Render every smooth gradient as a flat ink sampled from its own ramp —
   * the second standing constraint beside `flat`, and the same design: it
   * changes what renders, never the data, so toggling it off restores every
   * gradient exactly. Suppressed: the orb's disc gradient (linear, radial and
   * conic), the background gradient, sector `ramp` cells, and the vignette.
   * Kept: sliced-mode bands (discrete samples — already flat fills) and
   * pattern-internal gradient spreads (they are the artwork's texture).
   *
   * Independent of `flat` on purpose: gradients read as sphere *surfaces*,
   * shading reads as sphere *lighting*, and the client may want either cue
   * gone without the other. Like `flat`, deliberately not in `doc.locks`.
   */
  solidFills: boolean
}

export type Preset = {
  id: string
  name: string
  savedAt: number
  doc: OrbDoc
}

/**
 * v4 is the mode-first restructure: `orbType` replaces `orb.mode` (sliced
 * retired), `subLocks` absorbs `lockPatternCount`, per-object property locks,
 * and `colorSource`. The old "Orb style" recipes are gone with the dropdown —
 * shaded-sphere is "Color type + shading on", overlap-bloom is a documented
 * Pattern-type recipe.
 */
export const DOC_VERSION = 4

/** A pattern tile at scale 1 spans this fraction of the orb diameter. */
export const TILE_BASE_FRACTION = 0.5
