/**
 * Procedural "rules" texture: N straight hairlines radiating from a shared
 * focus, spread across an angular range. Matches the reference comp
 * (Examples/2026-08-25) — a handful of thin rules fanning out from a focus
 * just off the tile, crossing a dark field. Sparse, confident, print-like.
 *
 * Output is a complete SVG document string that satisfies the pattern
 * pipeline contract in `../parse.ts`: 400×400 tile, a full-bleed background
 * plate as the first child (hidden by the app by default), one ink hex on
 * plain `<line>` elements, no defs/gradients/masks/opacity, deterministic.
 */

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'

export type RulesParams = {
  /** Number of hairlines. */
  count: number
  /** Stroke width in tile units. */
  strokeWidth: number
  /** Focus x in tile units; may sit outside the 0–400 tile. */
  focusX: number
  /** Focus y in tile units; may sit outside the 0–400 tile. */
  focusY: number
  /** First line's angle in degrees (0 = +x, 90 = +y i.e. down; SVG y-down). */
  startAngle: number
  /** Angular range the lines spread across, in degrees. 360 = full burst. */
  sweep: number
  /** Lines start this far from the focus instead of at it. Default 0. */
  innerRadius?: number
}

const round2 = (n: number): number => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/** Distance from the focus past the farthest tile corner, so every line
 *  that points at the tile fully crosses it. */
const outerRadius = (fx: number, fy: number): number => {
  let max = 0
  for (const cx of [0, TILE]) {
    for (const cy of [0, TILE]) {
      max = Math.max(max, Math.hypot(cx - fx, cy - fy))
    }
  }
  return max * 1.05
}

export function rulesSvg(params: RulesParams): string {
  const { count, strokeWidth, focusX, focusY, startAngle, sweep } = params
  const innerRadius = params.innerRadius ?? 0
  const n = Math.max(1, Math.floor(count))
  // A full-circle burst spaces by sweep/n so the last line does not land on
  // the first; a partial fan spans the whole sweep inclusively.
  const fullCircle = sweep >= 360
  const step = n > 1 ? sweep / (fullCircle ? n : n - 1) : 0
  const rOuter = outerRadius(focusX, focusY)

  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    const a = ((startAngle + step * i) * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const x1 = round2(focusX + dx * innerRadius)
    const y1 = round2(focusY + dy * innerRadius)
    const x2 = round2(focusX + dx * rOuter)
    const y2 = round2(focusY + dy * rOuter)
    lines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="${round2(strokeWidth)}"/>`,
    )
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>`,
    ...lines,
    `</svg>`,
  ].join('\n')
}

export const RULES_VARIANTS: ReadonlyArray<{
  id: string
  name: string
  params: RulesParams
}> = [
  {
    // The comp's look: a sparse fan converging on a focus just off the
    // bottom-right corner, rules running up and to the left across the tile.
    id: 'tx-rules-corner-fan',
    name: 'Rules — Corner Fan',
    params: {
      count: 12,
      strokeWidth: 3,
      focusX: 448,
      focusY: 448,
      startAngle: 186,
      sweep: 68,
      innerRadius: 56,
    },
  },
  {
    id: 'tx-rules-burst',
    name: 'Rules — Burst',
    params: {
      count: 28,
      strokeWidth: 2.5,
      focusX: 200,
      focusY: 200,
      startAngle: -90,
      sweep: 360,
      innerRadius: 34,
    },
  },
  {
    id: 'tx-rules-edge-fan',
    name: 'Rules — Edge Fan',
    params: {
      count: 24,
      strokeWidth: 2,
      focusX: -48,
      focusY: 200,
      startAngle: -52,
      sweep: 104,
      innerRadius: 40,
    },
  },
]
