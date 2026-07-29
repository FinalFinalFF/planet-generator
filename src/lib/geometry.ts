/** Pure geometry helpers shared by the renderer. */

export type Box = { x: number; y: number; w: number; h: number }

export const DEG = Math.PI / 180

/** Unit vector for an angle in degrees measured clockwise from 12 o'clock. */
export function dirFromAngle(angleDeg: number): { dx: number; dy: number } {
  const a = angleDeg * DEG
  return { dx: Math.sin(a), dy: -Math.cos(a) }
}

/** Round to a short decimal string — keeps exported SVG readable and small. */
export function n(v: number, places = 3): string {
  if (!Number.isFinite(v)) return '0'
  const s = v.toFixed(places)
  return s.replace(/\.?0+$/, '') || '0'
}

/** Endpoints of a linear gradient spanning `box` along `angleDeg`. */
export function linearEndpoints(box: Box, angleDeg: number) {
  const { dx, dy } = dirFromAngle(angleDeg)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const half = (Math.abs(dx) * box.w + Math.abs(dy) * box.h) / 2
  return {
    x1: cx - dx * half,
    y1: cy - dy * half,
    x2: cx + dx * half,
    y2: cy + dy * half,
  }
}

/** A closed circle as a path — needed for even-odd compound shapes. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)},${n(cy)}a${n(r)},${n(r)} 0 1,0 ${n(r * 2)},0a${n(r)},${n(r)} 0 1,0 ${n(-r * 2)},0Z`
}

/**
 * Crescent (lune): the planet disc minus a disc of the same radius pushed
 * `offset` toward `angleDeg`. Rendered with fill-rule="evenodd".
 */
export function crescentPath(cx: number, cy: number, r: number, angleDeg: number, offset: number): string {
  const { dx, dy } = dirFromAngle(angleDeg)
  return (
    circlePath(cx, cy, r) + circlePath(cx + dx * offset, cy + dy * offset, r)
  )
}

/** One wedge of a conic sweep, from `a0` to `a1` degrees, radius `r`. */
export function wedgePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = dirFromAngle(a0)
  const p1 = dirFromAngle(a1)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return (
    `M${n(cx)},${n(cy)}` +
    `L${n(cx + p0.dx * r)},${n(cy + p0.dy * r)}` +
    `A${n(r)},${n(r)} 0 ${large},1 ${n(cx + p1.dx * r)},${n(cy + p1.dy * r)}Z`
  )
}

/** Elliptical arc from `start` to `start + sweep`, rotated by `rotation`. */
export function arcPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  sweep: number,
  rotation: number,
): string {
  const clamped = Math.max(-359.9, Math.min(359.9, sweep))
  const pt = (deg: number) => {
    // Parametric point on the unrotated ellipse, then rotate.
    const t = (deg - 90) * DEG
    const ex = Math.cos(t) * rx
    const ey = Math.sin(t) * ry
    const rr = rotation * DEG
    return {
      x: cx + ex * Math.cos(rr) - ey * Math.sin(rr),
      y: cy + ex * Math.sin(rr) + ey * Math.cos(rr),
    }
  }
  const p0 = pt(start)
  const p1 = pt(start + clamped)
  const large = Math.abs(clamped) > 180 ? 1 : 0
  const dir = clamped >= 0 ? 1 : 0
  return `M${n(p0.x)},${n(p0.y)}A${n(rx)},${n(ry)} ${n(rotation)} ${large},${dir} ${n(p1.x)},${n(p1.y)}`
}

/** Point on a circle around the planet, for satellite placement. */
export function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const { dx, dy } = dirFromAngle(angleDeg)
  return { x: cx + dx * r, y: cy + dy * r }
}
