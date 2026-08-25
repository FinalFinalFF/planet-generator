/**
 * Procedural "hatch" texture: diagonal hairline stripe families. Matches the
 * reference comp (Examples/2026-08-25) bottom panels — fields of 45° pinstripes
 * whose density steps between zones, and two families crossing into a woven
 * plaid when `cross` is on.
 *
 * Output is a complete SVG document string that satisfies the pattern
 * pipeline contract in `../parse.ts`: 400×400 tile, a full-bleed background
 * plate as the first child (hidden by the app by default), one ink hex on
 * plain `<line>` elements, no defs/gradients/masks/opacity, deterministic.
 *
 * Tiling: a diagonal family is periodic along its offset axis (c = x + y for
 * the 45° diagonal, c = y − x for the 135° one), and translating the tile by
 * 400 on either axis shifts c by exactly ±400. So any set of offsets defined
 * on [0, 400) and replicated at ±400 tiles seamlessly on both axes — which is
 * why spacing is snapped so each band holds a whole number of stripes, and
 * why band boundaries sit at fractions of the 400-unit offset period.
 */

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'

export type HatchParams = {
  /**
   * Primary stripe direction. 45 runs lower-left → upper-right, 135 runs
   * upper-left → lower-right. Only the two diagonals tile seamlessly on a
   * square, so the type enforces them.
   */
  angle: 45 | 135
  /**
   * Perpendicular distance between stripes in tile units. Snapped to the
   * nearest value that keeps the 400×400 tile seamless (a whole number of
   * stripes per band).
   */
  spacing: number
  /** Stroke width in tile units. */
  strokeWidth: number
  /** Draw a second family at 90° to the first — crosshatch / plaid. */
  cross: boolean
  /**
   * Density banding: the field divides into `count` equal bands perpendicular
   * to the stripes; every other band widens the spacing by `coarseFactor`,
   * giving the fine/coarse zoning of the reference. Omit for a uniform field.
   */
  bands?: {
    /** Number of bands across one tile period. */
    count: number
    /** Spacing multiplier for the alternate (coarse) bands; ≥ 1. */
    coarseFactor: number
  }
}

const round2 = (n: number): number => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/**
 * Stripe offsets along the family's perpendicular axis (in c units, where one
 * unit of perpendicular distance is 1/√2 c units), covering one 400-unit
 * period. Band boundaries land on i·(400/count), so the set is tile-periodic
 * by construction.
 */
function stripeOffsets(spacing: number, bands: HatchParams['bands']): number[] {
  const dReq = Math.max(0.5, spacing) * Math.SQRT2
  const count = Math.max(1, Math.floor(bands?.count ?? 1))
  const factor = Math.max(1, bands?.coarseFactor ?? 1)
  const bandWidth = TILE / count
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    const start = i * bandWidth
    const dWanted = dReq * (i % 2 === 1 ? factor : 1)
    const n = Math.max(1, Math.round(bandWidth / dWanted))
    const d = bandWidth / n
    for (let j = 0; j < n; j++) offsets.push(start + j * d)
  }
  return offsets
}

const lineEl = (x1: number, y1: number, x2: number, y2: number, sw: number): string =>
  `<line x1="${round2(x1)}" y1="${round2(y1)}" x2="${round2(x2)}" y2="${round2(y2)}" stroke="${INK}" stroke-width="${round2(sw)}"/>`

/**
 * One diagonal family. Offsets are replicated at ±400 so every line whose
 * stroke can touch the tile is drawn; segments overhang the tile slightly
 * (the pattern cell clips them) so strokes never stop short of an edge.
 */
function familyLines(diag: 45 | 135, offsets: number[], sw: number): string[] {
  const margin = sw + 2
  const ext = sw + 8
  const lines: string[] = []
  if (diag === 45) {
    // x + y = c; c spans [0, 800] across the tile.
    for (const o of offsets) {
      for (const m of [-1, 0, 1, 2]) {
        const c = o + m * TILE
        if (c < -margin || c > 2 * TILE + margin) continue
        lines.push(lineEl(c + ext, -ext, -ext, c + ext, sw))
      }
    }
  } else {
    // y − x = b; b spans [−400, 400] across the tile.
    for (const o of offsets) {
      for (const m of [-2, -1, 0, 1]) {
        const b = o + m * TILE
        if (b < -TILE - margin || b > TILE + margin) continue
        lines.push(lineEl(-ext, b - ext, TILE + ext, b + TILE + ext, sw))
      }
    }
  }
  return lines
}

export function hatchSvg(params: HatchParams): string {
  const { angle, spacing, strokeWidth, cross, bands } = params
  const offsets = stripeOffsets(spacing, bands)
  const lines = familyLines(angle, offsets, strokeWidth)
  if (cross) {
    const other: 45 | 135 = angle === 45 ? 135 : 45
    lines.push(...familyLines(other, offsets, strokeWidth))
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>`,
    ...lines,
    `</svg>`,
  ].join('\n')
}

export const HATCH_VARIANTS: ReadonlyArray<{
  id: string
  name: string
  params: HatchParams
}> = [
  {
    // The comp's bottom-right look: one 45° pinstripe family whose density
    // steps between fine and wider-spaced zones.
    id: 'tx-hatch-banded-pinstripe',
    name: 'Hatch — Banded Pinstripe',
    params: {
      angle: 45,
      spacing: 5,
      strokeWidth: 1.5,
      cross: false,
      bands: { count: 4, coarseFactor: 2.5 },
    },
  },
  {
    // The comp's bottom-left look: two families crossing, band density
    // varying in both, weaving a plaid.
    id: 'tx-hatch-weave',
    name: 'Hatch — Weave',
    params: {
      angle: 45,
      spacing: 6,
      strokeWidth: 1.6,
      cross: true,
      bands: { count: 2, coarseFactor: 2 },
    },
  },
  {
    id: 'tx-hatch-hairline',
    name: 'Hatch — Hairline Field',
    params: {
      angle: 45,
      spacing: 4,
      strokeWidth: 1.2,
      cross: false,
    },
  },
]
