/**
 * Procedural scanline-dither texture: vertical ink bars on a uniform column
 * grid, each column broken into seeded runs of ink and gap, with bar widths
 * stepping between 1–3 grid units mid-column — the vertical-bar glitch look.
 *
 * Seamlessness is by construction:
 * - Vertically, each column's run sequence is a cyclic partition of the row
 *   count, rotated by a per-column offset; a run crossing y=400 is split into
 *   a bottom piece and a top piece, so tiled copies join exactly.
 * - Horizontally, a wide bar that would overhang x=0 or x=400 wraps modulo
 *   the tile and is emitted as two rects.
 *
 * Output honors the pattern-pipeline contract (see parse.ts): a full-bleed
 * background plate first, then plain <rect> geometry in one ink hex, no defs,
 * no gradients, no opacity, integer coordinates.
 */

import { makeRng, type Rng } from '../../rng'

export type DitherParams = {
  /**
   * Grid resolution: cells per axis across the 400-unit tile. Snapped to the
   * nearest divisor of 400 so the grid tiles exactly (e.g. 20, 40, 50).
   */
  cells: number
  /** Target ink coverage, 0..1 (approximate — widths and gutters modulate it). */
  density: number
  /** 0..1 — run-length bias: how streaky the vertical runs are (higher = longer). */
  runBias: number
  seed: string
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'

/** Grid sizes that divide the tile exactly; `cells` snaps to the nearest. */
const CELL_COUNTS = [8, 10, 16, 20, 25, 40, 50, 80] as const

type Run = { ink: boolean; len: number; width: number }

/** Exponential-ish run length around `mean`, always ≥ 1. */
function runLen(rng: Rng, mean: number): number {
  return Math.max(1, Math.round(-mean * Math.log(1 - rng.next())))
}

function pickWidth(rng: Rng): number {
  return rng.weighted([1, 2, 3] as const, [0.7, 0.21, 0.09])
}

/**
 * Cyclic partition of `rows` into alternating ink/gap runs. Ink runs may be
 * split into two widths (the mid-bar glitch step). Lengths sum to exactly
 * `rows`, which is what makes the column wrap seamlessly.
 */
function columnRuns(rng: Rng, rows: number, density: number, runBias: number): Run[] {
  // Ink run length is set by streakiness alone; gap length is derived so the
  // ink : gap ratio hits `density`. Coupling ink length to density makes
  // sparse settings degenerate into stubby blocks instead of bars.
  const meanInk = Math.min(rows, 1.5 + runBias * 10)
  const meanGap = Math.min(rows, Math.max(0.7, (meanInk * (1 - density)) / Math.max(density, 0.05)))
  const runs: Run[] = []
  let ink = rng.bool(density)
  let total = 0
  while (total < rows) {
    const len = Math.min(runLen(rng, ink ? meanInk : meanGap), rows - total)
    if (ink && len >= 3 && rng.bool(0.35)) {
      // Glitch step: one bar, two widths.
      const split = rng.int(1, len - 1)
      const w1 = pickWidth(rng)
      let w2 = pickWidth(rng)
      if (w2 === w1) w2 = w1 === 1 ? 2 : w1 - 1
      runs.push({ ink: true, len: split, width: w1 })
      runs.push({ ink: true, len: len - split, width: w2 })
    } else {
      runs.push({ ink, len, width: ink ? pickWidth(rng) : 0 })
    }
    total += len
    ink = !ink
  }
  return runs
}

export function ditherSvg(params: DitherParams): string {
  const cells = CELL_COUNTS.reduce((a, b) =>
    Math.abs(b - params.cells) < Math.abs(a - params.cells) ? b : a,
  )
  const cell = TILE / cells
  const gutter = Math.max(1, Math.round(cell * 0.2))
  const density = Math.min(1, Math.max(0, params.density))
  const runBias = Math.min(1, Math.max(0, params.runBias))
  const rng = makeRng(params.seed)

  const rects: string[] = []
  const rect = (x: number, y: number, w: number, h: number) => {
    rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`)
  }

  /** One vertical ink segment; splits at both tile edges as needed. */
  const emit = (col: number, yStartRow: number, lenRows: number, widthUnits: number) => {
    // Horizontal: anchor the widened bar around its lane, wrap modulo the tile.
    const x0u = col - ((widthUnits - 1) >> 1)
    const xRaw = x0u * cell + gutter
    const w = widthUnits * cell - 2 * gutter
    const x = ((xRaw % TILE) + TILE) % TILE
    const xSpans: Array<[number, number]> =
      x + w <= TILE ? [[x, w]] : [[x, TILE - x], [0, x + w - TILE]]
    // Vertical: split a run crossing y=400 into bottom + top pieces.
    const y = yStartRow * cell
    const h = lenRows * cell
    const ySpans: Array<[number, number]> =
      y + h <= TILE ? [[y, h]] : [[y, TILE - y], [0, y + h - TILE]]
    for (const [sx, sw] of xSpans) {
      for (const [sy, sh] of ySpans) rect(sx, sy, sw, sh)
    }
  }

  for (let col = 0; col < cells; col++) {
    const runs = columnRuns(rng, cells, density, runBias)
    const offset = rng.int(0, cells - 1)
    let p = offset
    for (const run of runs) {
      if (run.ink) emit(col, p % cells, run.len, run.width)
      p += run.len
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>`,
    ...rects,
    `</svg>`,
  ].join('\n')
}

export const DITHER_VARIANTS: ReadonlyArray<{ id: string; name: string; params: DitherParams }> = [
  {
    id: 'tx-dither-dense',
    name: 'Dither — Dense Scan',
    params: { cells: 40, density: 0.72, runBias: 0.45, seed: 'dither-dense-01' },
  },
  {
    id: 'tx-dither-sparse',
    name: 'Dither — Sparse Scan',
    params: { cells: 40, density: 0.28, runBias: 0.6, seed: 'dither-sparse-01' },
  },
  {
    id: 'tx-dither-coarse',
    name: 'Dither — Coarse Scan',
    params: { cells: 20, density: 0.55, runBias: 0.35, seed: 'dither-coarse-01' },
  },
]
