/**
 * Procedural stipple texture: an organic paint-speckle field — many small
 * filled spots of varying radius, clustered like spattered ink rather than
 * uniform noise. A coarse cell grid gets seeded density weights; each spot
 * picks its cell through those weights, then jitters well past the cell
 * bounds so the grid itself never reads. Larger spots may render as small
 * irregular polygons instead of circles, which gives the splat edge its
 * risograph-grain character.
 *
 * Seamlessness: a spot whose extent crosses a tile edge is re-emitted offset
 * by ±400 on the crossing axis (both, for corners), so the wrap completes it.
 *
 * Output honors the pattern-pipeline contract (see parse.ts): a full-bleed
 * background plate first, then plain <circle>/<polygon> geometry in one ink
 * hex, no defs, no gradients, no opacity, coordinates rounded to 1 decimal.
 */

import { makeRng } from '../../rng'

export type StippleParams = {
  /** Total spot count scattered across the 400-unit tile. */
  count: number
  /** Smallest spot radius, tile units. */
  minRadius: number
  /** Largest spot radius, tile units. */
  maxRadius: number
  /** 0 = even scatter, 1 = strongly patchy (dense drifts and open areas). */
  cluster: number
  seed: string
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'
/** Density-cell grid resolution per axis (coarse on purpose — patches, not pixels). */
const GRID = 6

const r1 = (v: number) => Math.round(v * 10) / 10
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const wrap = (v: number) => ((v % TILE) + TILE) % TILE

export function stippleSvg(params: StippleParams): string {
  const count = Math.max(1, Math.round(params.count))
  const rMin = Math.max(0.2, params.minRadius)
  const rMax = Math.max(rMin, params.maxRadius)
  const cluster = clamp01(params.cluster)
  const rng = makeRng(params.seed)

  // Seeded density weight per coarse cell. At cluster 0 every cell weighs 1
  // (even scatter); at 1 the weight is a hard power curve, so a handful of
  // cells hog the spots and the rest go nearly empty.
  const cellIdx: number[] = []
  const weights: number[] = []
  for (let i = 0; i < GRID * GRID; i++) {
    const u = rng.next()
    cellIdx.push(i)
    weights.push(1 - cluster + cluster * Math.pow(u, 4) * 8)
  }

  const cellW = TILE / GRID
  const shapes: string[] = []

  /** Emit `draw(dx, dy)` once per wrap offset the extent demands. */
  const emitWrapped = (cx: number, cy: number, ext: number, draw: (dx: number, dy: number) => string) => {
    const xs = [0]
    if (cx - ext < 0) xs.push(TILE)
    if (cx + ext > TILE) xs.push(-TILE)
    const ys = [0]
    if (cy - ext < 0) ys.push(TILE)
    if (cy + ext > TILE) ys.push(-TILE)
    for (const dx of xs) for (const dy of ys) shapes.push(draw(dx, dy))
  }

  for (let s = 0; s < count; s++) {
    const cell = rng.weighted(cellIdx, weights)
    const ci = cell % GRID
    const cj = Math.floor(cell / GRID)
    // Uniform in-cell position plus a jitter that spills past the cell —
    // neighbouring cells overlap, so the grid leaves no visible seams.
    const jx = (rng.next() - 0.5) * cellW * 0.9
    const jy = (rng.next() - 0.5) * cellW * 0.9
    const cx = wrap((ci + rng.next()) * cellW + jx)
    const cy = wrap((cj + rng.next()) * cellW + jy)
    // Power curve: many small spots, an occasional large one.
    const r = rMin + (rMax - rMin) * Math.pow(rng.next(), 2.4)

    // Blob decision + vertex draws happen unconditionally sized by the same
    // RNG order per spot, so geometry stays stable per seed.
    const wantBlob = rng.bool(0.55) && r >= 2.4
    if (wantBlob) {
      // Small irregular 4–6-gon: angular enough to read as a splat.
      const n = rng.int(4, 6)
      const rot = rng.next() * Math.PI * 2
      const offs: Array<[number, number]> = []
      let ext = 0
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * Math.PI * 2 + (rng.next() - 0.5) * (Math.PI / n)
        const rr = r * (0.65 + rng.next() * 0.55)
        if (rr > ext) ext = rr
        offs.push([Math.cos(a) * rr, Math.sin(a) * rr])
      }
      emitWrapped(cx, cy, ext, (dx, dy) => {
        const pts = offs.map(([ox, oy]) => `${r1(cx + dx + ox)},${r1(cy + dy + oy)}`).join(' ')
        return `<polygon points="${pts}" fill="${INK}"/>`
      })
    } else {
      emitWrapped(cx, cy, r, (dx, dy) =>
        `<circle cx="${r1(cx + dx)}" cy="${r1(cy + dy)}" r="${r1(r)}" fill="${INK}"/>`,
      )
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>`,
    ...shapes,
    `</svg>`,
  ].join('\n')
}

export const STIPPLE_VARIANTS: ReadonlyArray<{ id: string; name: string; params: StippleParams }> = [
  {
    id: 'tx-stipple-fine',
    name: 'Stipple — Fine Grain',
    params: { count: 880, minRadius: 0.8, maxRadius: 4.2, cluster: 0.55, seed: 'stipple-fine-01' },
  },
  {
    id: 'tx-stipple-coarse',
    name: 'Stipple — Coarse Spatter',
    params: { count: 240, minRadius: 1.6, maxRadius: 11, cluster: 0.7, seed: 'stipple-coarse-01' },
  },
  {
    id: 'tx-stipple-mist',
    name: 'Stipple — Sparse Mist',
    params: { count: 300, minRadius: 0.7, maxRadius: 2.2, cluster: 0.5, seed: 'stipple-mist-01' },
  },
]
