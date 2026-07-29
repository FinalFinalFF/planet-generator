import {
  DOC_VERSION,
  type AccentLayer,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type Layer,
  type LayerMask,
  type MaskMode,
  type PatternLayer,
  type PlanetDoc,
  type PlanetStyle,
  type ShadingLayer,
  type SliceConfig,
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
  mode: 'planet',
  cx: 0.22,
  cy: -0.18,
  radius: 0.85,
  feather: 0,
}

export const DEFAULT_SLICES: SliceConfig = {
  count: 20,
  families: 2,
  curvature: 1.5,
  arc: 1,
  alpha: 1,
  modulation: 0.42,
  // Focus off to the left, so the ramp's first stop lands on the left limb.
  angle: 274,
  fan: 44,
  phase: 0.12,
  // Multiply keeps the base hues; screen washes the whole disc toward white.
  blend: 'multiply',
}

/* ---------- pattern layer color defaults ---------- */

/**
 * Sensible palette-slot assignment for a freshly added pattern layer.
 * The plate is hidden so the pattern reads as texture over the planet, and ink
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
      enabled: true,
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
export function defaultDoc(seed: string): PlanetDoc {
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
    makeShadingLayer({ id: 'sh-default' }),
    makeAccentLayer({ id: 'ac-default' }),
  ]

  return {
    version: DOC_VERSION,
    seed,
    canvas: { width: 1600, height: 1600 },
    paletteId: BUILTIN_PALETTES[0].id,
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
    planet: {
      visible: true,
      mode: 'disc',
      cx: 0.5,
      cy: 0.5,
      radius: 0.62,
      slices: { ...DEFAULT_SLICES },
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
    locks: {
      colors: false,
      planet: false,
      patterns: false,
      shading: false,
      accents: false,
      background: false,
    },
  }
}

export const DEFAULT_PATTERN_IDS = [DEFAULT_PATTERN_A, DEFAULT_PATTERN_B]

/* ---------- migration ---------- */

/**
 * Fill in anything a document saved by an older version is missing. Presets
 * store whole documents, so a v1 preset has to keep loading.
 */
export function normalizeDoc(doc: PlanetDoc): PlanetDoc {
  const planet = {
    ...doc.planet,
    mode: doc.planet.mode ?? 'disc',
    slices: { ...DEFAULT_SLICES, ...(doc.planet.slices ?? {}) },
  }
  const layers = doc.layers.map((layer) =>
    layer.kind === 'pattern'
      ? { ...layer, mask: { ...DEFAULT_LAYER_MASK, ...(layer.mask ?? {}) } }
      : layer,
  )
  return { ...doc, version: DOC_VERSION, planet, layers }
}

/* ---------- planet style recipes ---------- */

/**
 * Each style rewrites the planet mode, the shading, and the layer stack
 * together — the reference looks are combinations of all three, not one setting.
 * Palette, canvas, seed, locks and pattern choices are left alone.
 */
export function applyPlanetStyle(doc: PlanetDoc, style: PlanetStyle): PlanetDoc {
  const patterns = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
  const shading = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const accents = doc.layers.find((l): l is AccentLayer => l.kind === 'accent')

  const withShading = (patch: Partial<ShadingLayer>): ShadingLayer =>
    shading ? { ...shading, ...patch } : makeShadingLayer(patch)

  const rebuild = (next: Layer[]): PlanetDoc['layers'] => next

  switch (style) {
    case 'flat-disc':
      // The plain gradient circles of the reference: no shading at all, so the
      // disc stays graphic rather than photographic.
      return {
        ...doc,
        planet: { ...doc.planet, mode: 'disc' },
        layers: rebuild([
          ...patterns.map((p) => ({ ...p, visible: false })),
          withShading({ visible: false }),
          ...(accents ? [{ ...accents, visible: false }] : []),
        ]),
      }

    case 'shaded-sphere':
      return {
        ...doc,
        planet: { ...doc.planet, mode: 'disc' },
        layers: rebuild([
          ...patterns.map((p) => ({ ...p, visible: false })),
          withShading({
            visible: true,
            shadow: 0.86,
            highlight: 0.36,
            lightDistance: 0.5,
            highlightSize: 0.7,
            contactShadow: 0.58,
            opacity: 1,
            blend: 'normal',
          }),
          ...(accents ? [{ ...accents, visible: true }] : []),
        ]),
      }

    case 'patterned-disc':
      // Crisp ink across the whole disc, shading pulled back so the pattern
      // stays legible edge to edge.
      return {
        ...doc,
        planet: { ...doc.planet, mode: 'disc' },
        layers: rebuild([
          ...patterns.map((p, i) => ({
            ...p,
            visible: true,
            blend: (i === 0 ? 'normal' : p.blend) as BlendMode,
            opacity: i === 0 ? 0.72 : p.opacity,
            mask: { ...p.mask, mode: 'planet' as const },
          })),
          withShading({
            visible: true,
            shadow: 0.4,
            highlight: 0.16,
            contactShadow: 0.3,
            highlightSize: 0.9,
          }),
          ...(accents ? [{ ...accents, visible: true }] : []),
        ]),
      }

    case 'overlap-bloom':
      // Soft pattern-in-circle overlap: each pattern gets its own feathered
      // lens so textures meet in lens-shaped patches instead of covering
      // the whole disc.
      return {
        ...doc,
        planet: { ...doc.planet, mode: 'disc' },
        layers: rebuild([
          ...patterns.map((p, i) => ({
            ...p,
            visible: true,
            blend: (i % 2 === 0 ? 'multiply' : 'screen') as BlendMode,
            opacity: 0.5,
            mask: {
              mode: (i % 2 === 0 ? 'lens' : 'outside-lens') as MaskMode,
              cx: i % 2 === 0 ? 0.3 : -0.26,
              cy: i % 2 === 0 ? 0.26 : -0.22,
              radius: 0.9,
              feather: 0.55,
            },
          })),
          withShading({ visible: true, shadow: 0.62, highlight: 0.28, contactShadow: 0.42 }),
          ...(accents ? [{ ...accents, visible: true }] : []),
        ]),
      }

    case 'sliced-sweep':
      // Patterns and the terminator both fight the slice lattice, so the
      // slices carry the whole planet and only the accents stay.
      return {
        ...doc,
        planet: {
          ...doc.planet,
          mode: 'sliced',
          slices: { ...DEFAULT_SLICES, ...doc.planet.slices },
        },
        layers: rebuild([
          ...patterns.map((p) => ({ ...p, visible: false })),
          withShading({ visible: false }),
          ...(accents ? [{ ...accents, visible: true }] : []),
        ]),
      }
  }
}

/** Best-effort read of which style the current document resembles. */
export function detectPlanetStyle(doc: PlanetDoc): PlanetStyle | 'custom' {
  if (doc.planet.mode === 'sliced') return 'sliced-sweep'
  const patterns = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern' && l.visible)
  const shading = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const shaded = !!shading?.visible
  if (patterns.length === 0) return shaded ? 'shaded-sphere' : 'flat-disc'
  // Only call it overlap-bloom when every visible pattern is lens-confined;
  // a mix of full-disc ink and one lens patch is its own thing.
  if (patterns.every((p) => p.mask?.mode !== 'planet' && (p.mask?.feather ?? 0) > 0.2)) {
    return 'overlap-bloom'
  }
  if (patterns.every((p) => (p.mask?.mode ?? 'planet') === 'planet')) return 'patterned-disc'
  return 'custom'
}
