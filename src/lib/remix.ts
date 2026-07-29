/**
 * Seeded remix. Same seed + same palette + same locks ⇒ same output.
 *
 * Each locked section short-circuits to the incoming value, so the RNG stream
 * is consumed in a fixed order regardless of which sections are frozen — that
 * keeps unlocked sections stable when you toggle an unrelated lock.
 *
 * **A lock is absolute.** Nothing in this module writes to a locked section:
 * not Remix, not Remix All, not Shuffle colors, not a per-section randomize.
 * Every entry point guards on `doc.locks`, so a locked section cannot be
 * changed by accident from a caller that forgot to check.
 */

import {
  type AccentLayer,
  type LayerMask,
  type PlanetMode,
  type SliceConfig,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type GradientStop,
  type Layer,
  type LockSection,
  type Locks,
  type Palette,
  type PatternLayer,
  type PlanetDoc,
  type ShadingLayer,
} from '../types'
import { makeRng, type Rng } from './rng'
import { DEFAULT_LAYER_MASK, DEFAULT_SLICES, nextId } from './defaults'
import type { ParsedPattern } from './patterns/parse'
import { slotsByLightness } from './palettes'

export type RemixDeps = {
  /** Patterns that are parsed and therefore safe to reference. */
  available: ParsedPattern[]
  palette: Palette
}

/* ---------- color dealing ---------- */

type Deck = {
  dark: number[]
  mid: number[]
  light: number[]
  all: number[]
}

function buildDeck(palette: Palette): Deck {
  const byL = slotsByLightness(palette)
  const third = Math.max(1, Math.round(byL.length / 3))
  return {
    dark: byL.slice(0, third),
    mid: byL.slice(third, byL.length - third).length ? byL.slice(third, byL.length - third) : byL,
    light: byL.slice(-third).reverse(),
    all: byL,
  }
}

/** A run of adjacent-in-lightness slots, which is what reads as a sweep. */
function dealRamp(rng: Rng, palette: Palette, count: number): number[] {
  const byL = slotsByLightness(palette)
  const len = byL.length
  const n = Math.max(1, Math.min(count, len))

  // Contiguous and non-wrapping: a run that wraps past the light end back into
  // the dark slots can come out entirely dark, which reads as a black hole
  // against a dark background rather than as a planet.
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

  let stops: GradientStop[]
  if (lockColors) {
    // Reuse the existing colors but re-space them.
    const existing = prev.stops.slice().sort((a, b) => a.offset - b.offset)
    const count = Math.max(2, existing.length)
    stops = Array.from({ length: count }, (_, i) => ({
      id: nextId('s'),
      offset: count === 1 ? 0 : i / (count - 1),
      color: existing[i % existing.length].color,
    }))
  } else {
    stops = slots.map((slot, i) => {
      const base = stopCount === 1 ? 0 : i / (stopCount - 1)
      const jitter = i === 0 || i === stopCount - 1 ? 0 : rng.float(-0.05, 0.05)
      return {
        id: nextId('s'),
        offset: Math.max(0, Math.min(1, base + jitter)),
        color: { slot } as ColorRef,
      }
    })
    // A conic sweep should close on itself or it shows a hard seam.
    if (type === 'conic' && stops.length > 2) {
      stops[stops.length - 1] = { ...stops[stops.length - 1], color: { ...stops[0].color } }
    }
  }

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
  const colors =
    lockColors && prev
      ? // Keep the palette assignment but stretch/trim to the new pattern.
        parsed.groups.map((g, i) => prev.colors[i] ?? prev.colors[prev.colors.length - 1] ?? { slot: 0, alpha: g.isBackground ? 0 : 1 })
      : remixPatternColors(rng, parsed, deps.palette, blend)

  // Most layers cover the whole disc; a minority get a feathered lens so
  // textures sometimes meet in patches instead of always blanketing the planet.
  const maskMode = rng.weighted(['planet', 'lens', 'outside-lens'] as const, [0.6, 0.24, 0.16])
  const mask: LayerMask =
    maskMode === 'planet'
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
  const pickAccent = (fallback: ColorRef): ColorRef =>
    lockColors ? fallback : { slot: rng.pick([...deck.light, ...deck.mid]) }

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

  const rimOn = rng.bool(0.68)
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

/* ---------- entry points ---------- */

/**
 * Pick a palette from the seed. Kept here rather than in the caller so the same
 * seed reproduces the palette choice too, and so the `colors` lock still wins.
 */
export function pickPalette(palettes: Palette[], seed: string, current: string): Palette {
  if (palettes.length === 0) return { id: current, name: current, colors: ['#000000'] }
  const rng = makeRng(`${seed}-palette`)
  const others = palettes.filter((p) => p.id !== current)
  const pool = others.length > 0 ? others : palettes
  return rng.pick(pool)
}

export function remix(doc: PlanetDoc, seed: string, deps: RemixDeps): PlanetDoc {
  const rng = makeRng(seed)
  const { locks } = doc
  const palette = deps.palette
  const deck = buildDeck(palette)

  // --- background ---
  const background = locks.background
    ? doc.background
    : (() => {
        const kind = rng.weighted(['gradient', 'solid', 'transparent'] as const, [0.66, 0.28, 0.06])
        const g = remixGradient(rng, palette, doc.background.gradient, locks.colors)
        const bgGradient: Gradient = {
          ...g,
          // Backgrounds want a quiet, dark-leaning ramp.
          type: rng.bool(0.6) ? 'radial' : 'linear',
          stops: locks.colors
            ? doc.background.gradient.stops
            : [
                { id: nextId('s'), offset: 0, color: { slot: deck.dark[rng.int(0, deck.dark.length - 1)] } },
                { id: nextId('s'), offset: rng.float(0.5, 0.8), color: { slot: deck.dark[0] } },
                { id: nextId('s'), offset: 1, color: { slot: deck.dark[0] } },
              ],
          radius: rng.float(0.7, 1.1),
        }
        return {
          kind,
          color: locks.colors ? doc.background.color : { slot: deck.dark[0] },
          gradient: bgGradient,
          vignette: rng.float(0.1, 0.5),
        }
      })()

  // --- planet ---
  const sliced = rng.bool(0.22)
  const slices: SliceConfig = {
    ...DEFAULT_SLICES,
    count: rng.int(9, 26),
    families: rng.bool(0.75) ? 2 : 1,
    curvature: rng.float(1.1, 3.2),
    arc: rng.bool(0.7) ? 1 : rng.float(0.7, 1.35),
    // The base family stays near-opaque or the crescents stop reading.
    alpha: rng.float(0.88, 1),
    modulation: rng.float(0.2, 0.5),
    angle: rng.int(0, 359),
    fan: rng.float(26, 74),
    phase: rng.float(0, 0.4),
    blend: rng.weighted(
      ['multiply', 'overlay', 'screen', 'normal'] as BlendMode[],
      [0.42, 0.28, 0.18, 0.12],
    ),
  }

  const planet = locks.planet
    ? doc.planet
    : {
        ...doc.planet,
        visible: true,
        mode: (sliced ? 'sliced' : 'disc') as PlanetMode,
        slices,
        cx: rng.float(0.45, 0.55),
        cy: rng.float(0.45, 0.55),
        radius: rng.float(0.5, 0.74),
        gradient: remixGradient(rng, palette, doc.planet.gradient, locks.colors),
        stroke: {
          ...doc.planet.stroke,
          enabled: !sliced && rng.bool(0.18),
          width: rng.float(1, 4),
          color: locks.colors ? doc.planet.stroke.color : { slot: deck.light[0] },
          opacity: rng.float(0.25, 0.7),
        },
      }

  // --- layers ---
  const prevPatterns = doc.layers.filter((l): l is PatternLayer => l.kind === 'pattern')
  const prevShading = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const prevAccents = doc.layers.find((l): l is AccentLayer => l.kind === 'accent')

  // A slice lattice already carries the whole planet; heavy texture and a
  // terminator on top of it just read as mud.
  const slicedNow = planet.mode === 'sliced'
  const patternCount =
    deps.available.length === 0 ? 0 : rng.weighted([1, 2, 3], [0.3, 0.45, 0.25])
  const patterns: PatternLayer[] = locks.patterns
    ? prevPatterns
    : Array.from({ length: patternCount }, (_, i) => {
        const layer = remixPatternLayer(rng, deps, prevPatterns[i], locks.colors)
        return slicedNow ? { ...layer, visible: i === 0 && rng.bool(0.35) } : layer
      })

  const shading: ShadingLayer | null = prevShading
    ? locks.shading
      ? prevShading
      : {
          ...remixShading(rng, palette, prevShading, locks.colors),
          visible: !slicedNow,
        }
    : null

  const accents: AccentLayer | null = prevAccents
    ? locks.accents
      ? prevAccents
      : remixAccents(rng, palette, prevAccents, locks.colors)
    : null

  // Stack order: patterns, then shading, with accents free to sit above or below.
  // The roll happens either way to keep the RNG stream fixed, but a locked
  // accent layer keeps whichever side of the patterns it was already on —
  // otherwise a patterns-only remix would silently restack it.
  const rolledBelow = rng.bool(0.3)
  const prevAccentAt = doc.layers.findIndex((l) => l.kind === 'accent')
  const prevPatternAt = doc.layers.findIndex((l) => l.kind === 'pattern')
  const accentsWereBelow =
    prevAccentAt >= 0 && prevPatternAt >= 0 && prevAccentAt < prevPatternAt
  const accentsBelow = locks.accents ? accentsWereBelow : rolledBelow

  const layers: Layer[] = []
  if (accents && accentsBelow) layers.push(accents)
  layers.push(...patterns)
  if (shading) layers.push(shading)
  if (accents && !accentsBelow) layers.push(accents)

  return { ...doc, seed, background, planet, layers }
}

/**
 * Randomize one section and leave everything else alone — the inverse of the
 * locks, implemented by inverting them so there is only one code path deciding
 * what a section's randomization means.
 *
 * `doc.seed` is deliberately left untouched. The header seed reproduces a *full*
 * remix; a partial one is an edit, the same as moving a slider, and claiming
 * otherwise would make the seed a lie.
 */
export function remixSection(
  doc: PlanetDoc,
  section: Exclude<LockSection, 'colors'>,
  seed: string,
  deps: RemixDeps,
): PlanetDoc {
  if (doc.locks[section]) return doc // the lock wins
  const inverted: Locks = {
    colors: true,
    background: true,
    planet: true,
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
 * Respects the `colors` lock: a lock is absolute, so this is a no-op while
 * colors are frozen.
 */
export function shuffleColors(doc: PlanetDoc, palette: Palette, seed: string): PlanetDoc {
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

  const planet = {
    ...doc.planet,
    gradient: { ...doc.planet.gradient, stops: rampFor(doc.planet.gradient.stops, false) },
    stroke: { ...doc.planet.stroke, color: { ...doc.planet.stroke.color, slot: deck.light[0] } },
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
      return {
        ...layer,
        colors: layer.colors.map((c) =>
          (c.alpha ?? 1) <= 0.001
            ? c // a hidden plate stays hidden
            : { ...c, slot: shuffled[i++ % shuffled.length], hex: null },
        ),
      }
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

  return { ...doc, background, planet, layers }
}
