/**
 * Procedural texture: concentric halftone rings.
 *
 * Emits a complete SVG document that satisfies the pattern-pipeline contract
 * (see parse.ts): a 400×400 tile whose first child is a full-bleed background
 * plate, followed by plain stroke-only <circle> elements in a single ink hex.
 * Ring weight ramps from the center outward while spacing stays regular,
 * which is what gives the print-like halftone read.
 *
 * Output is fully deterministic — geometry is a pure function of the params.
 */

export type RingsParams = {
  /** Ring-family center, in tile units (0–400). May sit on an edge or corner for fans. */
  cx: number
  cy: number
  /** Number of rings. */
  count: number
  /** Radius of the innermost ring. */
  innerRadius: number
  /** Center-to-center spacing between consecutive rings. */
  spacing: number
  /** Stroke width of the innermost ring. */
  innerWeight: number
  /** Stroke width of the outermost ring. */
  outerWeight: number
  /**
   * Exponent shaping the weight ramp: 1 is linear, >1 holds near innerWeight
   * longer, <1 rushes toward outerWeight. Defaults to 1.
   */
  ramp?: number
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'

/** Round to ≤2 decimals without trailing zeros. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Shortest distance from a point to the tile rect (0 when inside). */
function distToTile(x: number, y: number): number {
  const dx = Math.max(0 - x, 0, x - TILE)
  const dy = Math.max(0 - y, 0, y - TILE)
  return Math.hypot(dx, dy)
}

/** Distance from a point to the farthest tile corner. */
function maxCornerDist(x: number, y: number): number {
  let max = 0
  for (const cx of [0, TILE]) {
    for (const cy of [0, TILE]) {
      max = Math.max(max, Math.hypot(cx - x, cy - y))
    }
  }
  return max
}

export function ringsSvg(params: RingsParams): string {
  const { cx, cy, count, innerRadius, spacing, innerWeight, outerWeight } = params
  const ramp = params.ramp ?? 1
  const near = distToTile(cx, cy)
  const far = maxCornerDist(cx, cy)

  const circles: string[] = []
  for (let i = 0; i < count; i++) {
    const r = innerRadius + i * spacing
    if (r <= 0) continue
    const t = count > 1 ? i / (count - 1) : 0
    const w = innerWeight + (outerWeight - innerWeight) * Math.pow(t, ramp)
    if (w <= 0) continue
    // Skip rings whose stroke annulus cannot touch the tile.
    if (r + w / 2 < near || r - w / 2 > far) continue
    circles.push(
      `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${INK}" stroke-width="${fmt(w)}"/>`,
    )
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">` +
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>` +
    circles.join('') +
    `</svg>`
  )
}

export const RINGS_VARIANTS: ReadonlyArray<{ id: string; name: string; params: RingsParams }> = [
  {
    id: 'tx-rings-halftone',
    name: 'Halftone Rings',
    params: {
      cx: 200,
      cy: 200,
      count: 13,
      innerRadius: 10,
      spacing: 15,
      innerWeight: 1.2,
      outerWeight: 10,
      ramp: 1.4,
    },
  },
  {
    id: 'tx-rings-hairline',
    name: 'Hairline Rings',
    params: {
      cx: 200,
      cy: 200,
      count: 28,
      innerRadius: 6,
      spacing: 10,
      innerWeight: 1.2,
      outerWeight: 1.2,
    },
  },
  {
    id: 'tx-rings-corner-fan',
    name: 'Corner Fan',
    params: {
      cx: 0,
      cy: 400,
      count: 17,
      innerRadius: 16,
      spacing: 32,
      innerWeight: 11,
      outerWeight: 1.5,
      ramp: 0.8,
    },
  },
]
