/**
 * Procedural texture sources — the abstract direction's print vocabulary
 * (concentric rings, radial rules, dither columns, stepped stripes), generated
 * as SVG strings and fed through the exact same parse → recolor pipeline as
 * the files in `Patterns/`. That is the whole design: because they are
 * ordinary pattern sources, they get palette-slot mapping, pattern layers,
 * sector texture cells, imports-style listing, and remix reach for free.
 *
 * `load` is synchronous work behind a Promise so the registry's lazy-loading
 * contract holds without a special case.
 */

import type { PatternSource } from './source'
import { RINGS_VARIANTS, ringsSvg } from './textures/rings'
import { RULES_VARIANTS, rulesSvg } from './textures/rules'
import { DITHER_VARIANTS, ditherSvg } from './textures/dither'
import { STEPS_VARIANTS, stepsSvg } from './textures/steps'
import { WAVE_VARIANTS, waveSvg } from './textures/wave'
import { DOTS_VARIANTS, dotsSvg } from './textures/dots'
import { STIPPLE_VARIANTS, stippleSvg } from './textures/stipple'
import { HATCH_VARIANTS, hatchSvg } from './textures/hatch'

export const PROCEDURAL_SOURCES: PatternSource[] = [
  ...RINGS_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(ringsSvg(v.params)),
  })),
  ...RULES_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(rulesSvg(v.params)),
  })),
  ...DITHER_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(ditherSvg(v.params)),
  })),
  ...STEPS_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(stepsSvg(v.params)),
  })),
  // The second wave, mined from the older reference boards (see CHANGELOG):
  // wave/zigzag rule fields, ramped halftone dots, organic stipple grain,
  // diagonal pinstripe crosshatch.
  ...WAVE_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(waveSvg(v.params)),
  })),
  ...DOTS_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(dotsSvg(v.params)),
  })),
  ...STIPPLE_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(stippleSvg(v.params)),
  })),
  ...HATCH_VARIANTS.map((v) => ({
    id: v.id,
    name: v.name,
    load: () => Promise.resolve(hatchSvg(v.params)),
  })),
]
