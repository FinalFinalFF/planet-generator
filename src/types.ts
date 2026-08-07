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

export const ORB_MODES = ['disc', 'sliced'] as const
export type OrbMode = (typeof ORB_MODES)[number]

/**
 * The sliced sphere from the reference.
 *
 * A family is a set of concentric circles about a focus sitting *outside* the
 * orb, drawn largest first so each smaller circle paints over the last. What
 * stays visible of each is an annulus, and because the focus is off to one side
 * those annuli read as curved bands sweeping right across the disc. The radii
 * are derived to span the orb exactly, so the bands always reach both limbs.
 *
 * A second family with a focus `fan` degrees away is laid over translucently;
 * its bands cross the first family's and cut them into the flat diamond cells of
 * the reference.
 *
 * Keeping the base family opaque is the whole trick — a uniformly translucent
 * stack just lets the last circle drawn swamp everything underneath it.
 */
export type SliceConfig = {
  /** Bands per family. */
  count: number
  /** 1 = plain arc bands; 2 = the crossing lattice. */
  families: 1 | 2
  /**
   * Distance from the orb center to a family's focus, in orb radii.
   * Near 1 the bands curve hard; large values flatten them toward straight
   * stripes.
   */
  curvature: number
  /** Vertical squash of each band (ry ÷ rx). 1 = circles. */
  arc: number
  /** Base-family alpha. 1 gives clean bands; lower values wash them together. */
  alpha: number
  /** Second-family alpha — how hard the lattice cuts into the base bands. */
  modulation: number
  /** Direction of the base family's focus, degrees clockwise from 12 o'clock. */
  angle: number
  /** Angular separation between the two families' foci, in degrees. */
  fan: number
  /** Offset applied to the second family's position along the ramp. */
  phase: number
  /** How the second family composites onto the base. */
  blend: BlendMode
}

export type Orb = {
  visible: boolean
  mode: OrbMode
  /** Center as a fraction of canvas width/height. */
  cx: number
  cy: number
  /** Radius as a fraction of min(width, height) / 2. */
  radius: number
  /** Colors for both modes: `sliced` samples this ramp per slice. */
  gradient: Gradient
  slices: SliceConfig
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

export type OrbDoc = {
  version: number
  seed: string
  canvas: Canvas
  paletteId: string
  background: Background
  orb: Orb
  layers: Layer[]
  locks: Locks
  /**
   * Freeze how many pattern layers a remix produces, while still letting it
   * re-roll what each one is. Separate from `locks.patterns`, which freezes the
   * layers wholesale — this keeps a composition simple (say, one texture) without
   * giving up randomization inside it.
   */
  lockPatternCount: boolean
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
}

export type Preset = {
  id: string
  name: string
  savedAt: number
  doc: OrbDoc
}

export const DOC_VERSION = 3

/** A pattern tile at scale 1 spans this fraction of the orb diameter. */
export const TILE_BASE_FRACTION = 0.5

/**
 * Named recipes for the "Orb style" dropdown. Each one rewrites the orb
 * mode, the shading, and the layer stack together — the looks in the reference
 * material are combinations, not single settings.
 */
export const ORB_STYLES = [
  'flat-disc',
  'shaded-sphere',
  'patterned-disc',
  'overlap-bloom',
  'sliced-sweep',
] as const
export type OrbStyle = (typeof ORB_STYLES)[number]

export const ORB_STYLE_LABELS: Record<OrbStyle, string> = {
  'flat-disc': 'Flat disc',
  'shaded-sphere': 'Shaded sphere',
  'patterned-disc': 'Patterned disc',
  'overlap-bloom': 'Overlap bloom',
  'sliced-sweep': 'Sliced sweep',
}
