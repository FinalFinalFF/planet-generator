/**
 * Procedural texture: frequency-halving stripe steps.
 *
 * Emits a complete SVG document that satisfies the pattern-pipeline contract
 * (see parse.ts): a 400×400 tile whose first child is a full-bleed background
 * plate, followed by plain <rect> stripes in a single ink hex.
 *
 * The tile is divided into bands; band k draws stripes of thickness
 * finePeriod/2 · 2^k with an equal gap, so stripe frequency halves band to
 * band — hairlines on one side stepping up to coarse blocks on the other.
 * With `checker` on, alternate bands are phase-offset by half their own
 * period so thick bands interlock with their neighbors as a checkerboard.
 *
 * Seamlessness: every band's period must divide the 400 tile exactly (the
 * doubling chain finePeriod · 2^k for all k), and band widths must sum to
 * 400 — both are validated. A half-period phase offset keeps stripe edges on
 * period multiples, so no stripe ever straddles the tile edge.
 *
 * Output is fully deterministic — geometry is a pure function of the params.
 */

export type StepsParams = {
  /** Number of bands across the tile; frequency halves from band 0 to band k. */
  bands: number
  /**
   * Stripe period (stripe + equal gap) of the finest band, in tile units.
   * Doubles each band; every doubling must divide 400 (e.g. 12.5 → 12.5, 25,
   * 50, 100, 200).
   */
  finePeriod: number
  /**
   * Band widths from fine to coarse, summing to 400. Omit for equal widths.
   */
  bandWidths?: number[]
  /**
   * Phase-offset every other band by half its own period so adjacent thick
   * bands interlock as a checker.
   */
  checker: boolean
  /**
   * Stripe direction: 'horizontal' lays vertical bands left to right with
   * horizontal stripes (the reference); 'vertical' swaps the axes.
   */
  orientation: 'horizontal' | 'vertical'
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'
const EPS = 0.001

/** Round to ≤2 decimals without trailing zeros. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

export function stepsSvg(params: StepsParams): string {
  const { bands, finePeriod, checker, orientation } = params

  if (!Number.isInteger(bands) || bands < 1) {
    throw new Error(`steps: bands must be a positive integer, got ${bands}`)
  }
  for (let k = 0; k < bands; k++) {
    const p = finePeriod * 2 ** k
    if (Math.abs(TILE / p - Math.round(TILE / p)) > EPS) {
      throw new Error(`steps: band ${k} period ${p} does not divide ${TILE}; the tile would not repeat seamlessly`)
    }
  }

  // Band edges along the cross axis. Custom widths must sum to the tile.
  const edges: number[] = [0]
  if (params.bandWidths) {
    if (params.bandWidths.length !== bands) {
      throw new Error(`steps: bandWidths has ${params.bandWidths.length} entries for ${bands} bands`)
    }
    for (const w of params.bandWidths) edges.push(edges[edges.length - 1] + w)
    if (Math.abs(edges[bands] - TILE) > EPS) {
      throw new Error(`steps: bandWidths sum to ${edges[bands]}, must be ${TILE}`)
    }
    edges[bands] = TILE
  } else {
    for (let k = 1; k <= bands; k++) edges.push((k * TILE) / bands)
  }

  const rects: string[] = []
  for (let k = 0; k < bands; k++) {
    const bandStart = edges[k]
    const bandSize = edges[k + 1] - edges[k]
    const period = finePeriod * 2 ** k
    const thickness = period / 2
    const phase = checker && k % 2 === 1 ? thickness : 0
    for (let s = phase; s + thickness <= TILE + EPS; s += period) {
      if (orientation === 'horizontal') {
        rects.push(
          `<rect x="${fmt(bandStart)}" y="${fmt(s)}" width="${fmt(bandSize)}" height="${fmt(thickness)}" fill="${INK}"/>`,
        )
      } else {
        rects.push(
          `<rect x="${fmt(s)}" y="${fmt(bandStart)}" width="${fmt(thickness)}" height="${fmt(bandSize)}" fill="${INK}"/>`,
        )
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">` +
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>` +
    rects.join('') +
    `</svg>`
  )
}

export const STEPS_VARIANTS: ReadonlyArray<{ id: string; name: string; params: StepsParams }> = [
  {
    id: 'tx-steps-halving',
    name: 'Halving Stripes',
    params: {
      bands: 5,
      finePeriod: 12.5,
      bandWidths: [40, 60, 80, 100, 120],
      checker: true,
      orientation: 'horizontal',
    },
  },
  {
    id: 'tx-steps-checker',
    name: 'Step Checker',
    params: {
      bands: 3,
      finePeriod: 50,
      bandWidths: [100, 140, 160],
      checker: true,
      orientation: 'horizontal',
    },
  },
  {
    id: 'tx-steps-upright',
    name: 'Upright Steps',
    params: {
      bands: 5,
      finePeriod: 12.5,
      checker: false,
      orientation: 'vertical',
    },
  },
]
