/**
 * Motion — the time dimension.
 *
 * One pure function is the whole design: `motionAt(spec, t)` maps a document's
 * MotionSpec and a time to the values of every animated property. The editor
 * preview calls it from rAF and writes the results onto the live SVG nodes;
 * the video exporter steps t through period × fps frames and pushes each
 * through the same serialize→rasterize path the PNG export uses — preview ≡
 * export by construction, no second implementation to drift. (This is also why
 * the editor does NOT animate with free-running CSS/SMIL: a CSS timeline
 * cannot be deterministically seeked through an <img> rasterization.)
 *
 * Loop discipline: every channel's frequency is an integer number of turns per
 * period, so `motionAt(spec, 0) ≡ motionAt(spec, period)` exactly — asserted
 * in remix.test.ts.
 *
 * Phase 1 ships Orbit (accents revolve about the orb center) and Drift (the
 * composition's one slow rotation). Per-object direction alternates by node
 * order — deterministic with no per-object storage; documented, not dealt.
 */

import type { MotionSpec } from '../types'

export type MotionValues = {
  /** Composition rotation in degrees (segments group / pattern layer groups). */
  driftAngle: number
  /** Accent revolution about the orb center, degrees. */
  orbitAngle: number
}

export function motionAt(spec: MotionSpec, t: number): MotionValues {
  if (!spec.enabled || spec.period <= 0) return { driftAngle: 0, orbitAngle: 0 }
  const phase = (((t % spec.period) + spec.period) % spec.period) / spec.period
  return {
    driftAngle: spec.drift.on ? 360 * spec.drift.turns * phase : 0,
    orbitAngle: spec.orbit.on ? 360 * spec.orbit.turns * phase : 0,
  }
}

/**
 * Write `motionAt` onto the live SVG. Nodes opt in with `data-motion`
 * ("drift" | "orbit") and carry their rotation center in `data-motion-center`
 * ("x y", canvas units). Direction alternates by encounter order within each
 * kind. At angle 0 the transform attribute is removed, so the paused document
 * is byte-identical to a never-animated one — the still is frame zero.
 *
 * `data-*` never reaches exports (serializeSvg strips it); the `transform`
 * values DO serialize, which is exactly what frame export wants.
 */
export function applyMotion(svg: SVGSVGElement, spec: MotionSpec, t: number): void {
  const { driftAngle, orbitAngle } = motionAt(spec, t)
  const counters: Record<string, number> = { drift: 0, orbit: 0 }
  for (const el of svg.querySelectorAll<SVGGraphicsElement>('[data-motion]')) {
    const kind = el.getAttribute('data-motion')
    if (kind !== 'drift' && kind !== 'orbit') continue
    const index = counters[kind]++
    const base = kind === 'drift' ? driftAngle : orbitAngle
    const dir = index % 2 === 0 ? 1 : -1
    const angle = base * dir
    if (Math.abs(angle % 360) < 1e-9) {
      el.removeAttribute('transform')
      continue
    }
    const center = (el.getAttribute('data-motion-center') ?? '').split(' ')
    const cx = Number(center[0]) || 0
    const cy = Number(center[1]) || 0
    el.setAttribute('transform', `rotate(${(angle % 360).toFixed(4)} ${cx} ${cy})`)
  }
}
