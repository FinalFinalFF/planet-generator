/**
 * Procedural texture: halftone dot field.
 *
 * Emits a complete SVG document that satisfies the pattern-pipeline contract
 * (see parse.ts): a 400×400 tile whose first child is a full-bleed background
 * plate, followed by plain <circle> elements in a single ink hex. Dot radius
 * follows a ramp across the field — small scattered dots dissolving into
 * large, slightly merged ones — which is what gives the print-halftone read.
 *
 * Tiling is seamless by construction: the grid pitch divides the tile, dots
 * that overhang an edge are re-drawn offset by ±400 on that axis so the
 * clipped halves complete, and the ramp is ping-pong (rise then fall
 * symmetrically) so its value matches at opposite edges. The radial mode is
 * mirror-symmetric about the tile center, which tiles for the same reason.
 *
 * Output is fully deterministic — geometry is a pure function of the params.
 */

export type DotsParams = {
  /** Center-to-center grid pitch in tile units; must divide 400 for a seamless tile. */
  pitch: number
  /** True for a 45°-staggered halftone screen; false for a straight grid. */
  stagger: boolean
  /** Dot radius at the low end of the ramp. */
  minRadius: number
  /**
   * Dot radius at the high end. May slightly exceed half the nearest-neighbor
   * spacing so peak dots touch and merge, as in the reference.
   */
  maxRadius: number
  /**
   * Ramp direction in degrees. Snapped to 45° increments — 0 runs along x,
   * 90 along y, 45/135 along the diagonals — because only those projections
   * stay periodic across the tile. Ignored in radial mode.
   */
  rampAngle: number
  /**
   * Exponent shaping the ramp: 1 is linear, >1 holds near minRadius longer
   * before rushing toward maxRadius. Defaults to 1.
   */
  rampExponent?: number
  /**
   * 'linear' (default): ping-pong ramp along rampAngle.
   * 'radial': largest at the tile center, fading toward the corners.
   */
  rampMode?: 'linear' | 'radial'
}

const TILE = 400
const PLATE = '#0A0A0A'
const INK = '#F2EFE8'

/** Round to ≤2 decimals without trailing zeros. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Triangle wave: 0→1 over the first half of the period, 1→0 over the second. */
function pingPong(s: number): number {
  const f = ((s % 1) + 1) % 1
  return f < 0.5 ? f * 2 : (1 - f) * 2
}

/** Ramp position 0–1 at a point, periodic across the tile on both axes. */
function rampT(x: number, y: number, params: DotsParams): number {
  if ((params.rampMode ?? 'linear') === 'radial') {
    const d = Math.hypot(x - TILE / 2, y - TILE / 2)
    const reach = (TILE / 2) * Math.SQRT2
    return Math.max(0, 1 - d / reach)
  }
  // Snap to the four tileable directions: projections x, x+y, y, x−y are each
  // periodic mod 400 when the tile repeats, so the ping-pong value matches at
  // opposite edges. Arbitrary angles would not.
  const a = ((params.rampAngle % 180) + 180) % 180
  const k = Math.round(a / 45) % 4
  const s = k === 0 ? x : k === 1 ? x + y : k === 2 ? y : x - y
  return pingPong(s / TILE)
}

export function dotsSvg(params: DotsParams): string {
  const { pitch, stagger, minRadius, maxRadius } = params
  const exponent = params.rampExponent ?? 1
  const cols = Math.max(1, Math.round(TILE / pitch))

  const circles: string[] = []
  const emit = (cx: number, cy: number, r: number) => {
    // Re-draw edge-crossing dots wrapped by ±400 so clipped halves complete.
    const dxs = [0]
    if (cx - r < 0) dxs.push(TILE)
    if (cx + r > TILE) dxs.push(-TILE)
    const dys = [0]
    if (cy - r < 0) dys.push(TILE)
    if (cy + r > TILE) dys.push(-TILE)
    for (const dx of dxs) {
      for (const dy of dys) {
        circles.push(`<circle cx="${fmt(cx + dx)}" cy="${fmt(cy + dy)}" r="${fmt(r)}" fill="${INK}"/>`)
      }
    }
  }

  const rowH = stagger ? pitch / 2 : pitch
  const rows = stagger ? cols * 2 : cols
  for (let j = 0; j < rows; j++) {
    const cy = (j + 0.5) * rowH
    const xOffset = stagger && j % 2 === 1 ? 0 : pitch / 2
    for (let i = 0; i < cols; i++) {
      const cx = i * pitch + xOffset
      const t = Math.pow(rampT(cx, cy, params), exponent)
      const r = minRadius + (maxRadius - minRadius) * t
      if (r <= 0.05) continue
      emit(cx, cy, r)
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">` +
    `<rect x="0" y="0" width="${TILE}" height="${TILE}" fill="${PLATE}"/>` +
    circles.join('') +
    `</svg>`
  )
}

export const DOTS_VARIANTS: ReadonlyArray<{ id: string; name: string; params: DotsParams }> = [
  {
    id: 'tx-dots-halftone-ramp',
    name: 'Halftone Ramp',
    params: {
      pitch: 20,
      stagger: true,
      minRadius: 0.9,
      maxRadius: 8.2,
      rampAngle: 45,
      rampExponent: 1.9,
    },
  },
  {
    id: 'tx-dots-bloom',
    name: 'Dot Bloom',
    params: {
      pitch: 25,
      stagger: true,
      minRadius: 0.5,
      maxRadius: 10,
      rampAngle: 0,
      rampExponent: 1.4,
      rampMode: 'radial',
    },
  },
  {
    id: 'tx-dots-polka',
    name: 'Fine Polka',
    params: {
      pitch: 16,
      stagger: true,
      minRadius: 2.6,
      maxRadius: 2.6,
      rampAngle: 0,
    },
  },
]
