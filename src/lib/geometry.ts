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
 * Crescent (lune): the orb disc minus a disc of the same radius pushed
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

/**
 * The intersection of a circle with an axis-aligned rect that has been rotated
 * about the circle's center, as one closed path of line and arc segments.
 *
 * Because the rotation is about the circle's own center, the circle is
 * invariant under it — so the intersection is computed in the unrotated frame
 * (axis-aligned rect vs. circle) and only the resulting points are rotated
 * into place. Flat and ramp sector cells paint this path directly, with no clip
 * at all, so they import into design tools as plain shapes; texture cells clip
 * to it so they need exactly one clip level — nesting a rect clip inside the orb
 * clip mis-rasterizes in Chrome when the host <svg> is CSS-scaled.
 *
 * Returns '' when the shapes do not overlap.
 */
export function circleRectIntersectionPath(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  angleDeg: number,
): string {
  const EPS = 1e-6
  const a = angleDeg * DEG
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const rot = (x: number, y: number) => {
    const dx = x - cx
    const dy = y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
  const fmt = (p: { x: number; y: number }) => `${n(p.x)},${n(p.y)}`
  const inCircle = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + EPS

  // Rect corners, walked clockwise (screen coords, y down).
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]

  // Rect fully inside the circle: the rect is the intersection.
  if (corners.every((c) => inCircle(c.x, c.y))) {
    const p = corners.map((c) => rot(c.x, c.y))
    return `M${fmt(p[0])}L${fmt(p[1])}L${fmt(p[2])}L${fmt(p[3])}Z`
  }

  // Circle fully inside the rect: the circle is the intersection.
  if (cx - r >= x0 - EPS && cx + r <= x1 + EPS && cy - r >= y0 - EPS && cy + r <= y1 + EPS) {
    return circlePath(cx, cy, r)
  }

  // Walk the rect perimeter clockwise, collecting the pieces inside the circle
  // and the circle-crossing points in traversal order.
  type Cross = { x: number; y: number; kind: 'exit' | 'entry' }
  type Piece =
    | { kind: 'line'; pts: { x: number; y: number }[] }
    | { kind: 'gap'; from: Cross; to: Cross }

  // Intersections of segment p→q with the circle, ordered along the segment.
  const segHits = (px: number, py: number, qx: number, qy: number) => {
    const dx = qx - px
    const dy = qy - py
    const fx = px - cx
    const fy = py - cy
    const A = dx * dx + dy * dy
    const B = 2 * (fx * dx + fy * dy)
    const C = fx * fx + fy * fy - r * r
    const disc = B * B - 4 * A * C
    if (disc <= 0 || A < EPS) return []
    const s = Math.sqrt(disc)
    return [(-B - s) / (2 * A), (-B + s) / (2 * A)]
      .filter((t) => t > EPS && t < 1 - EPS)
      .map((t) => ({ x: px + dx * t, y: py + dy * t }))
  }

  const events: Array<{ pt: { x: number; y: number }; inside: boolean } | Cross> = []
  let inside = inCircle(corners[0].x, corners[0].y)
  const startInside = inside
  for (let i = 0; i < 4; i++) {
    const p = corners[i]
    const q = corners[(i + 1) % 4]
    events.push({ pt: p, inside })
    for (const hit of segHits(p.x, p.y, q.x, q.y)) {
      inside = !inside
      events.push({ x: hit.x, y: hit.y, kind: inside ? 'entry' : 'exit' })
    }
  }
  if (inside !== startInside) return '' // tangent-degenerate; treat as empty

  const crossings = events.filter((e): e is Cross => 'kind' in e)
  if (crossings.length === 0) return '' // disjoint (corners outside, no hits)

  // Stitch events into alternating line runs (inside the circle) and arc gaps.
  const pieces: Piece[] = []
  let run: { x: number; y: number }[] = []
  let openExit: Cross | null = null
  const flushRun = () => {
    if (run.length > 0) pieces.push({ kind: 'line', pts: run })
    run = []
  }
  for (const e of events) {
    if ('kind' in e) {
      if (e.kind === 'exit') {
        run.push({ x: e.x, y: e.y })
        flushRun()
        openExit = e
      } else {
        if (openExit) pieces.push({ kind: 'gap', from: openExit, to: e })
        openExit = null
        run.push({ x: e.x, y: e.y })
      }
    } else if (e.inside) {
      run.push(e.pt)
    }
  }
  flushRun()
  // The walk may have started mid-arc (first corner outside): close the wrap.
  if (openExit) {
    const firstEntry = crossings.find((c) => c.kind === 'entry')
    if (firstEntry) pieces.push({ kind: 'gap', from: openExit, to: firstEntry })
  }
  // Merge a trailing line run into a leading one (perimeter wrap inside circle).
  if (
    pieces.length > 1 &&
    pieces[0].kind === 'line' &&
    pieces[pieces.length - 1].kind === 'line'
  ) {
    const tail = pieces.pop() as Extract<Piece, { kind: 'line' }>
    ;(pieces[0] as Extract<Piece, { kind: 'line' }>).pts = [
      ...tail.pts,
      ...(pieces[0] as Extract<Piece, { kind: 'line' }>).pts,
    ]
  }

  // Emit: lines as L runs, gaps as clockwise arcs (sweep=1 in screen coords).
  const arcSpan = (from: Cross, to: Cross) => {
    const a0 = Math.atan2(from.y - cy, from.x - cx)
    const a1 = Math.atan2(to.y - cy, to.x - cx)
    let span = a1 - a0
    while (span < 0) span += Math.PI * 2
    return span
  }
  let d = ''
  const rr = n(r)
  for (const piece of pieces) {
    if (piece.kind === 'line') {
      for (const pt of piece.pts) {
        const p = rot(pt.x, pt.y)
        d += d === '' ? `M${fmt(p)}` : `L${fmt(p)}`
      }
    } else {
      const large = arcSpan(piece.from, piece.to) > Math.PI ? 1 : 0
      const p = rot(piece.to.x, piece.to.y)
      if (d === '') {
        const p0 = rot(piece.from.x, piece.from.y)
        d += `M${fmt(p0)}`
      }
      d += `A${rr},${rr} 0 ${large},1 ${fmt(p)}`
    }
  }
  return d === '' ? '' : `${d}Z`
}

/** Rotate a point clockwise about a center, in screen coordinates. */
export function rotateAbout(x: number, y: number, angleDeg: number, cx: number, cy: number) {
  const a = angleDeg * DEG
  const dx = x - cx
  const dy = y - cy
  return {
    x: cx + dx * Math.cos(a) - dy * Math.sin(a),
    y: cy + dx * Math.sin(a) + dy * Math.cos(a),
  }
}

/** Point on a circle around the orb, for satellite placement. */
export function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const { dx, dy } = dirFromAngle(angleDeg)
  return { x: cx + dx * r, y: cy + dy * r }
}

/**
 * Exact bounding box of the region `circleRectIntersectionPath` draws: the
 * axis-aligned rect (x0,y0)–(x1,y1), rotated `angleDeg` about the circle's
 * center, intersected with the circle. The extremes of that region are among
 * the rect corners inside the circle, the rect-edge/circle crossings, and the
 * circle's four axis extremes that lie inside the rotated rect — so checking
 * just those points is exact, no sampling. Null when they do not overlap.
 */
export function circleRectIntersectionBBox(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  angleDeg: number,
): { x: number; y: number; w: number; h: number } | null {
  const EPS = 1e-6
  const a = angleDeg * DEG
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const rot = (x: number, y: number) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  })
  const unrot = (x: number, y: number) => ({
    x: cx + (x - cx) * cos + (y - cy) * sin,
    y: cy - (x - cx) * sin + (y - cy) * cos,
  })
  const inCircle = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + EPS
  const inRect = (x: number, y: number) =>
    x >= x0 - EPS && x <= x1 + EPS && y >= y0 - EPS && y <= y1 + EPS

  // Candidate points in the unrotated frame.
  const pts: { x: number; y: number }[] = []
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  for (const c of corners) if (inCircle(c.x, c.y)) pts.push(c)
  for (let i = 0; i < 4; i++) {
    const p = corners[i]
    const q = corners[(i + 1) % 4]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const fx = p.x - cx
    const fy = p.y - cy
    const A = dx * dx + dy * dy
    const B = 2 * (fx * dx + fy * dy)
    const C = fx * fx + fy * fy - r * r
    const disc = B * B - 4 * A * C
    if (disc < 0 || A < EPS) continue
    const s = Math.sqrt(disc)
    for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
      if (t >= -EPS && t <= 1 + EPS) pts.push({ x: p.x + dx * t, y: p.y + dy * t })
    }
  }
  // The circle's axis extremes are in *screen* axes, so test them unrotated.
  const rotated = pts.map((p) => rot(p.x, p.y))
  for (const e of [
    { x: cx - r, y: cy },
    { x: cx + r, y: cy },
    { x: cx, y: cy - r },
    { x: cx, y: cy + r },
  ]) {
    const u = unrot(e.x, e.y)
    if (inRect(u.x, u.y)) rotated.push(e)
  }
  if (rotated.length === 0) return null
  const xs = rotated.map((p) => p.x)
  const ys = rotated.map((p) => p.y)
  const bx = Math.min(...xs)
  const by = Math.min(...ys)
  return { x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by }
}

/** No cell narrower than this share of its row — slivers read as glitches. */
export const MIN_CELL_SHARE = 0.15

/**
 * A row's cell edges as fractions 0…1 across the orb, from relative widths.
 * Widths that are missing, mismatched with `count`, or non-positive fall back
 * to an even split; every share is held at or above MIN_CELL_SHARE.
 */
export function rowEdges(count: number, widths?: number[]): number[] {
  const n = Math.max(1, count)
  const valid = widths && widths.length === n && widths.every((w) => Number.isFinite(w) && w > 0)
  let shares = valid ? widths.map((w) => w / widths.reduce((a, b) => a + b, 0)) : Array(n).fill(1 / n)
  if (n > 1 && shares.some((x) => x < MIN_CELL_SHARE)) {
    // Lift small shares to the floor, taking the difference proportionally
    // from the rest.
    const lifted = shares.map((x) => Math.max(MIN_CELL_SHARE, x))
    const excess = lifted.reduce((a, b) => a + b, 0) - 1
    const room = lifted.reduce((a, x) => a + (x > MIN_CELL_SHARE ? x - MIN_CELL_SHARE : 0), 0)
    shares = lifted.map((x) => (x > MIN_CELL_SHARE && room > 0 ? x - (excess * (x - MIN_CELL_SHARE)) / room : x))
  }
  const edges = [0]
  for (const x of shares) edges.push(edges[edges.length - 1] + x)
  edges[edges.length - 1] = 1
  return edges
}

/**
 * Each sector cell's share of the disc's area — row A's cells, then row B's.
 * Depends only on the structure (chord offset, row counts, widths): rotation
 * does not change areas. Grid-sampled over the unit disc; plenty for ranking
 * cells, which is all remix uses it for (the photo pool prefers big cells).
 */
export function sectorCellAreas(
  offset: number,
  countA: number,
  countB: number,
  widthsA?: number[],
  widthsB?: number[],
): number[] {
  const N = 64
  const chord = Math.max(-0.95, Math.min(0.95, offset))
  const rows = [
    { edges: rowEdges(countA, widthsA), inRow: (y: number) => y < chord },
    { edges: rowEdges(countB, widthsB), inRow: (y: number) => y >= chord },
  ]
  const counts = rows.map((row) => new Array(row.edges.length - 1).fill(0))
  let total = 0
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -1 + (2 * (i + 0.5)) / N
      const y = -1 + (2 * (j + 0.5)) / N
      if (x * x + y * y > 1) continue
      total++
      const ri = rows[0].inRow(y) ? 0 : 1
      const u = (x + 1) / 2
      const edges = rows[ri].edges
      let ci = 0
      while (ci < edges.length - 2 && u >= edges[ci + 1]) ci++
      counts[ri][ci]++
    }
  }
  return [...counts[0], ...counts[1]].map((c) => c / total)
}
