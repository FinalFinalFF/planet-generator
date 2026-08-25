/**
 * The RSAC Brand System constants — values transcribed verbatim from the
 * brand-system token files (tokens/palette.css, neutrals.css, gradients.css).
 *
 * The named gradients are **hex-fixed by design** (2026-08-25 decision):
 * they are named brand assets, and a "Radiance" that re-tinted when the user
 * switched palettes would no longer be Radiance. Applying one writes ordinary
 * gradient stops whose ColorRefs carry the literal hex as the override and the
 * nearest palette slot as graceful degradation — clearing the override in the
 * editor lands on the nearest palette color instead of somewhere arbitrary.
 */

import type { Gradient, Palette } from '../types'
import { hexToLab, labDistance } from './color'

export type BrandGradient = {
  id: string
  name: string
  /** Degrees, clockwise from 12 o'clock — same convention as `Gradient.angle`. */
  angle: number
  /** Literal stops, by design. Offsets 0..1. */
  stops: { offset: number; hex: string }[]
  /** Member of the chained master-spectrum strip (each ends where the next begins). */
  chained: boolean
  /** Reserved for the logomark — shipped for completeness, shown in no picker. */
  reserved?: boolean
}

/**
 * Eight of the ten chain end-to-start into one master spectrum; Energy and
 * Contrast use off-chain hexes and present as cross-links. Contrast's authored
 * stops overshoot the 0..1 range (−7.57% / 112.83%); SVG clamps offsets, so it
 * is resampled here to the effective colors at 0% and 100% — the rendered
 * result is identical to the CSS original. Radiance keeps its mid stop
 * verbatim.
 */
export const BRAND_GRADIENTS: BrandGradient[] = [
  { id: 'rsac-atmosphere', name: 'Atmosphere', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#FDF9F6' }, { offset: 1, hex: '#CDE0FD' }] },
  { id: 'rsac-horizon', name: 'Horizon', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#CDE0FD' }, { offset: 1, hex: '#B08ADA' }] },
  { id: 'rsac-spectrum', name: 'Spectrum', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#B08ADA' }, { offset: 1, hex: '#DB4750' }] },
  { id: 'rsac-current', name: 'Current', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#DB4750' }, { offset: 1, hex: '#EA6F53' }] },
  { id: 'rsac-radiance', name: 'Radiance', angle: 180, chained: true,
    stops: [
      { offset: 0, hex: '#EA6F53' },
      { offset: 0.4424, hex: '#F39530' },
      { offset: 1, hex: '#FFC505' },
    ] },
  { id: 'rsac-glow', name: 'Glow', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#FFC505' }, { offset: 1, hex: '#E1C5CE' }] },
  { id: 'rsac-shift', name: 'Shift', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#E1C5CE' }, { offset: 1, hex: '#D893A8' }] },
  { id: 'rsac-convergence', name: 'Convergence', angle: 180, chained: true,
    stops: [{ offset: 0, hex: '#D893A8' }, { offset: 1, hex: '#00396C' }] },
  // Cross-links — off-chain hexes, honestly presented beside the strip.
  { id: 'rsac-energy', name: 'Energy', angle: 180, chained: false,
    stops: [{ offset: 0, hex: '#86D5B2' }, { offset: 1, hex: '#FDC513' }] },
  { id: 'rsac-contrast', name: 'Contrast', angle: 176.8, chained: false,
    // Resampled from #DF714C @−7.57% → #68F5D3 @112.83%.
    stops: [{ offset: 0, hex: '#D87954' }, { offset: 1, hex: '#75E7C5' }] },
  { id: 'rsac-logomark', name: 'Logomark', angle: 180, chained: false, reserved: true,
    stops: [{ offset: 0, hex: '#002F4B' }, { offset: 1, hex: '#000000' }] },
]

/** The pickable set — everything but the reserved logomark gradient. */
export const PICKABLE_BRAND_GRADIENTS = BRAND_GRADIENTS.filter((g) => !g.reserved)

/** Nearest palette slot to a hex, perceptually (OKLab distance). */
export function nearestSlot(hex: string, palette: Palette): number {
  const target = hexToLab(hex)
  let best = 0
  let bestD = Infinity
  palette.colors.forEach((c, i) => {
    const d = labDistance(target, hexToLab(c))
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/**
 * A brand gradient as an ordinary document `Gradient`. Hex overrides carry the
 * identity; the nearest slot is the fallback when an override is cleared.
 * Stop ids are deterministic per gradient — two applications of the same
 * preset are byte-identical, which the remix determinism tests rely on.
 */
export function brandGradientFor(
  brand: BrandGradient,
  palette: Palette,
  prev: Gradient,
): Gradient {
  return {
    ...prev,
    type: 'linear',
    angle: brand.angle,
    stops: brand.stops.map((s, i) => ({
      id: `${brand.id}-s${i}`,
      offset: s.offset,
      color: { slot: nearestSlot(s.hex, palette), hex: s.hex },
    })),
  }
}
