/**
 * The artwork. One <svg> element is the source of truth for both the live
 * preview and the SVG export, so nothing here may depend on browser-only CSS
 * that would not survive serialization.
 */

import { Fragment, type CSSProperties } from 'react'
import {
  TILE_BASE_FRACTION,
  type AccentLayer,
  type BlendMode,
  type ColorRef,
  type Gradient,
  type LayerMask,
  type Palette,
  type PatternLayer,
  type PlanetDoc,
  type ShadingLayer,
} from '../types'
import { DEFAULT_LAYER_MASK } from '../lib/defaults'
import { refAlpha, resolveColor } from '../lib/palettes'
import { clamp, mixHex, withAlpha } from '../lib/color'
import {
  arcPath,
  crescentPath,
  dirFromAngle,
  linearEndpoints,
  n,
  polar,
  wedgePath,
  type Box,
} from '../lib/geometry'
import { recolor, resolveTokens, type GroupPaint } from '../lib/patterns/registry'
import type { ParsedPattern } from '../lib/patterns/parse'

export type PlanetSvgProps = {
  doc: PlanetDoc
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  /** Suppress the background layer (used by the transparent export path). */
  transparent?: boolean
  idPrefix?: string
  svgRef?: React.Ref<SVGSVGElement>
  className?: string
  style?: CSSProperties
}

type Ctx = {
  doc: PlanetDoc
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  prefix: string
  /** Planet center + radius in user units. */
  cx: number
  cy: number
  r: number
  canvas: Box
}

const blendStyle = (blend: BlendMode): CSSProperties | undefined =>
  blend === 'normal' ? undefined : { mixBlendMode: blend }

function color(ref: ColorRef | undefined, palette: Palette): string {
  return withAlpha(resolveColor(ref, palette), refAlpha(ref))
}

/* ---------- gradients ---------- */

type Sample = { hex: string; alpha: number }

function sortedStops(g: Gradient) {
  return g.stops.slice().sort((a, b) => a.offset - b.offset)
}

/** Sample a gradient's stop list at `t` (0..1), interpolating in OKLab. */
function sampleGradient(g: Gradient, palette: Palette, t: number): Sample {
  const stops = sortedStops(g)
  if (stops.length === 0) return { hex: '#000000', alpha: 1 }
  if (t <= stops[0].offset) {
    return { hex: resolveColor(stops[0].color, palette), alpha: refAlpha(stops[0].color) }
  }
  const last = stops[stops.length - 1]
  if (t >= last.offset) {
    return { hex: resolveColor(last.color, palette), alpha: refAlpha(last.color) }
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.offset && t <= b.offset) {
      const span = b.offset - a.offset
      const k = span <= 0 ? 0 : (t - a.offset) / span
      return {
        hex: mixHex(resolveColor(a.color, palette), resolveColor(b.color, palette), k),
        alpha: refAlpha(a.color) + (refAlpha(b.color) - refAlpha(a.color)) * k,
      }
    }
  }
  return { hex: resolveColor(last.color, palette), alpha: refAlpha(last.color) }
}

/** Real SVG gradient defs for linear/radial. Conic is drawn as wedges instead. */
function GradientDef({
  id,
  gradient: g,
  box,
  palette,
}: {
  id: string
  gradient: Gradient
  box: Box
  palette: Palette
}) {
  const stops = sortedStops(g).map((s, i) => (
    <stop
      key={s.id ?? i}
      offset={n(clamp(s.offset, 0, 1), 4)}
      stopColor={resolveColor(s.color, palette)}
      stopOpacity={n(refAlpha(s.color), 4)}
    />
  ))

  if (g.type === 'radial') {
    const cx = box.x + g.focusX * box.w
    const cy = box.y + g.focusY * box.h
    const r = Math.max(1, g.radius * Math.max(box.w, box.h))
    return (
      <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={n(cx)} cy={n(cy)} r={n(r)}>
        {stops}
      </radialGradient>
    )
  }

  const { x1, y1, x2, y2 } = linearEndpoints(box, g.angle)
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={n(x1)}
      y1={n(y1)}
      x2={n(x2)}
      y2={n(y2)}
    >
      {stops}
    </linearGradient>
  )
}

/**
 * Conic sweep approximated with wedges. SVG has no conic gradient, so building
 * it out of geometry keeps preview and export identical instead of leaving the
 * export to fall back to something else.
 */
function ConicSweep({
  gradient: g,
  box,
  palette,
  clipId,
}: {
  gradient: Gradient
  box: Box
  palette: Palette
  clipId: string
}) {
  const segments = clamp(Math.round(g.segments || 180), 12, 720)
  const cx = box.x + g.focusX * box.w
  const cy = box.y + g.focusY * box.h
  // Reach the farthest corner from the focus — which is not the box diagonal
  // once the focus moves off center.
  const r =
    Math.max(
      Math.hypot(cx - box.x, cy - box.y),
      Math.hypot(cx - (box.x + box.w), cy - box.y),
      Math.hypot(cx - box.x, cy - (box.y + box.h)),
      Math.hypot(cx - (box.x + box.w), cy - (box.y + box.h)),
    ) * 1.02
  const step = 360 / segments
  const wedges: React.ReactNode[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments
    const s = sampleGradient(g, palette, t)
    const a0 = g.angle + i * step
    // Overlap by a fraction of a degree so anti-aliased seams do not show.
    const a1 = a0 + step + Math.min(0.6, step * 0.35)
    wedges.push(<path key={i} d={wedgePath(cx, cy, r, a0, a1)} fill={withAlpha(s.hex, s.alpha)} />)
  }
  return <g clipPath={`url(#${clipId})`}>{wedges}</g>
}

/* ---------- sliced sphere ---------- */

/**
 * Concentric bands about a focus outside the planet: drawn largest first, so
 * each smaller circle paints over the last and leaves an annulus visible. With
 * the focus off to one side those annuli read as curved bands sweeping across
 * the whole disc. The second family's focus sits `fan` degrees away, so its
 * bands cross the first family's and cut them into diamond cells.
 */
function SlicedPlanet({ ctx }: { ctx: Ctx }) {
  const { cx, cy, r, prefix, palette, doc } = ctx
  const s = doc.planet.slices
  const g = doc.planet.gradient
  const count = clamp(Math.round(s.count), 1, 96)
  const families = s.families === 1 ? 1 : 2
  const squash = clamp(s.arc, 0.05, 3)
  // Keep the focus outside the disc; inside it the bands collapse to a bullseye.
  const dist = Math.max(1.02, s.curvature) * r

  const family = (f: number, alpha: number) => {
    const focusAngle = s.angle + (families === 1 ? 0 : f === 0 ? -s.fan / 2 : s.fan / 2)
    const dir = dirFromAngle(focusAngle)
    const fx = cx + dir.dx * dist
    const fy = cy + dir.dy * dist
    // Radii derived to span the planet, so bands always reach both limbs.
    const rMin = Math.max(1, dist - r * 1.04)
    const rMax = dist + r * 1.04
    const out: React.ReactNode[] = []
    for (let i = count - 1; i >= 0; i--) {
      const t = count === 1 ? 0.5 : i / (count - 1)
      const rad = rMin + (rMax - rMin) * t
      const rampT = (((t + (f === 1 ? s.phase : 0)) % 1) + 1) % 1
      const sample = sampleGradient(g, palette, rampT)
      out.push(
        <ellipse
          key={`${f}-${i}`}
          cx={n(fx)}
          cy={n(fy)}
          rx={n(rad)}
          ry={n(rad * squash)}
          fill={withAlpha(sample.hex, sample.alpha * alpha)}
          transform={
            squash === 1 ? undefined : `rotate(${n(focusAngle)} ${n(fx)} ${n(fy)})`
          }
        />,
      )
    }
    return out
  }

  // Always clipped: bands are concentric, so letting them run free just floods
  // the canvas rather than scalloping a silhouette.
  return (
    <g clipPath={`url(#${prefix}-planet-clip)`}>
      <g>{family(0, clamp(s.alpha, 0, 1))}</g>
      {families === 2 && (
        <g style={blendStyle(s.blend)}>{family(1, clamp(s.modulation, 0, 1))}</g>
      )}
    </g>
  )
}

/* ---------- layers ---------- */

/**
 * Lens masks for pattern layers. A `<mask>` rather than nested clip paths,
 * because it covers the lens, its complement, and a feathered edge with one
 * mechanism.
 */
function LensMaskDef({ id, mask, ctx }: { id: string; mask: LayerMask; ctx: Ctx }) {
  const { cx, cy, r, canvas } = ctx
  const d = r * 2
  const lx = cx + mask.cx * d
  const ly = cy + mask.cy * d
  const lr = Math.max(0.5, mask.radius * r)
  const feather = clamp(mask.feather, 0, 1)
  const outside = mask.mode === 'outside-lens'
  const gradId = `${id}-falloff`

  // Luminance masks: white paints, black hides.
  const solid = outside ? '#000000' : '#ffffff'

  return (
    <>
      {feather > 0.001 && (
        <radialGradient id={gradId} gradientUnits="userSpaceOnUse" cx={n(lx)} cy={n(ly)} r={n(lr)}>
          <stop offset={n(Math.max(0, 1 - feather), 4)} stopColor={solid} />
          <stop offset="1" stopColor={outside ? '#ffffff' : '#000000'} />
        </radialGradient>
      )}
      <mask
        id={id}
        maskUnits="userSpaceOnUse"
        x={n(canvas.x)}
        y={n(canvas.y)}
        width={n(canvas.w)}
        height={n(canvas.h)}
      >
        {outside && (
          <rect
            x={n(canvas.x)}
            y={n(canvas.y)}
            width={n(canvas.w)}
            height={n(canvas.h)}
            fill="#ffffff"
          />
        )}
        <circle
          cx={n(lx)}
          cy={n(ly)}
          r={n(lr)}
          fill={feather > 0.001 ? `url(#${gradId})` : solid}
        />
      </mask>
    </>
  )
}

function PatternLayerView({ layer, ctx }: { layer: PatternLayer; ctx: Ctx }) {
  const parsed = ctx.parsedById.get(layer.patternId)
  if (!parsed) return null

  const { cx, cy, r, prefix, palette } = ctx
  const d = r * 2
  const mask = layer.mask ?? DEFAULT_LAYER_MASK
  const maskId = `${prefix}-lens-${layer.id}`
  const useMask = mask.mode !== 'planet'
  const paints: GroupPaint[] = parsed.groups.map((g) => {
    const ref = layer.colors[g.index]
    return { hex: resolveColor(ref ?? { slot: g.index }, palette), alpha: refAlpha(ref) }
  })
  const markup = recolor(parsed, resolveTokens(parsed, paints))
  const contentId = `${prefix}-pc-${layer.id}`
  const ox = layer.offsetX * d
  const oy = layer.offsetY * d

  if (layer.fit === 'cover') {
    // Oversize by 1.45 so rotation cannot expose a corner.
    const s = (d * layer.scale * 1.45) / Math.min(parsed.width, parsed.height)
    const transform =
      `translate(${n(cx + ox)} ${n(cy + oy)}) rotate(${n(layer.rotation)}) ` +
      `scale(${n(s, 5)}) translate(${n(-parsed.width / 2)} ${n(-parsed.height / 2)})`
    return (
      <Fragment>
        {useMask && (
          <defs>
            <LensMaskDef id={maskId} mask={mask} ctx={ctx} />
          </defs>
        )}
        <g
          clipPath={`url(#${prefix}-planet-clip)`}
          opacity={n(layer.opacity, 4)}
          style={blendStyle(layer.blend)}
        >
          <g mask={useMask ? `url(#${maskId})` : undefined}>
            <g transform={transform} dangerouslySetInnerHTML={{ __html: markup }} />
          </g>
        </g>
      </Fragment>
    )
  }

  const k = (d * TILE_BASE_FRACTION * layer.scale) / Math.max(parsed.width, parsed.height)
  const patternTransform =
    `translate(${n(cx + ox)} ${n(cy + oy)}) rotate(${n(layer.rotation)}) scale(${n(k, 5)})`
  return (
    <Fragment>
      <defs>
        <pattern
          id={contentId}
          patternUnits="userSpaceOnUse"
          width={n(parsed.width)}
          height={n(parsed.height)}
          patternTransform={patternTransform}
        >
          <g dangerouslySetInnerHTML={{ __html: markup }} />
        </pattern>
        {useMask && <LensMaskDef id={maskId} mask={mask} ctx={ctx} />}
      </defs>
      <g
        clipPath={`url(#${prefix}-planet-clip)`}
        opacity={n(layer.opacity, 4)}
        style={blendStyle(layer.blend)}
      >
        <rect
          x={n(cx - r)}
          y={n(cy - r)}
          width={n(d)}
          height={n(d)}
          fill={`url(#${contentId})`}
          mask={useMask ? `url(#${maskId})` : undefined}
        />
      </g>
    </Fragment>
  )
}

function ShadingLayerView({ layer, ctx }: { layer: ShadingLayer; ctx: Ctx }) {
  const { cx, cy, r, prefix, palette } = ctx
  const shadowHex = resolveColor(layer.shadowColor, palette)
  const highlightHex = resolveColor(layer.highlightColor, palette)
  const { dx, dy } = dirFromAngle(layer.lightAngle)
  const op = clamp(layer.opacity, 0, 1)

  const shadowId = `${prefix}-shade-${layer.id}`
  const hiId = `${prefix}-hi-${layer.id}`
  const contactId = `${prefix}-contact-${layer.id}`

  // Terminator: dark at the limb opposite the light, falling off across the disc.
  const sx = cx - dx * r * 1.02
  const sy = cy - dy * r * 1.02
  const sAmt = clamp(layer.shadow, 0, 1) * op
  const hAmt = clamp(layer.highlight, 0, 1) * op
  const cAmt = clamp(layer.contactShadow, 0, 1) * op

  const hx = cx + dx * r * clamp(layer.lightDistance, 0, 1.2)
  const hy = cy + dy * r * clamp(layer.lightDistance, 0, 1.2)
  const hr = Math.max(1, layer.highlightSize * r)

  return (
    <Fragment>
      <defs>
        <radialGradient
          id={shadowId}
          gradientUnits="userSpaceOnUse"
          cx={n(sx)}
          cy={n(sy)}
          r={n(r * 1.78)}
        >
          <stop offset="0" stopColor={shadowHex} stopOpacity={n(sAmt, 4)} />
          <stop offset="0.4" stopColor={shadowHex} stopOpacity={n(sAmt * 0.62, 4)} />
          <stop offset="0.72" stopColor={shadowHex} stopOpacity={n(sAmt * 0.2, 4)} />
          <stop offset="1" stopColor={shadowHex} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={hiId} gradientUnits="userSpaceOnUse" cx={n(hx)} cy={n(hy)} r={n(hr)}>
          <stop offset="0" stopColor={highlightHex} stopOpacity={n(hAmt, 4)} />
          <stop offset="0.38" stopColor={highlightHex} stopOpacity={n(hAmt * 0.42, 4)} />
          <stop offset="1" stopColor={highlightHex} stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={contactId}
          gradientUnits="userSpaceOnUse"
          cx={n(cx)}
          cy={n(cy)}
          r={n(r)}
        >
          <stop offset="0" stopColor={shadowHex} stopOpacity="0" />
          <stop offset="0.7" stopColor={shadowHex} stopOpacity="0" />
          <stop offset="0.92" stopColor={shadowHex} stopOpacity={n(cAmt * 0.45, 4)} />
          <stop offset="1" stopColor={shadowHex} stopOpacity={n(cAmt, 4)} />
        </radialGradient>
      </defs>
      {/* No group opacity: that would isolate the group and stop these from
          blending against the planet underneath. */}
      <g clipPath={`url(#${prefix}-planet-clip)`} style={blendStyle(layer.blend)}>
        {sAmt > 0.001 && (
          <circle
            cx={n(cx)}
            cy={n(cy)}
            r={n(r)}
            fill={`url(#${shadowId})`}
            style={{ mixBlendMode: 'multiply' }}
          />
        )}
        {cAmt > 0.001 && (
          <circle
            cx={n(cx)}
            cy={n(cy)}
            r={n(r)}
            fill={`url(#${contactId})`}
            style={{ mixBlendMode: 'multiply' }}
          />
        )}
        {hAmt > 0.001 && (
          <circle
            cx={n(cx)}
            cy={n(cy)}
            r={n(r)}
            fill={`url(#${hiId})`}
            style={{ mixBlendMode: 'screen' }}
          />
        )}
      </g>
    </Fragment>
  )
}

function AccentLayerView({ layer, ctx }: { layer: AccentLayer; ctx: Ctx }) {
  const { cx, cy, r, prefix, palette } = ctx
  const rimId = `${prefix}-rim-${layer.id}`
  const rim = layer.rim
  const rimDir = dirFromAngle(rim.angle)
  const rimSpan = Math.max(1, r * clamp(rim.spread, 0.05, 2))

  return (
    <Fragment>
      {rim.enabled && (
        <defs>
          <linearGradient
            id={rimId}
            gradientUnits="userSpaceOnUse"
            x1={n(cx + rimDir.dx * r)}
            y1={n(cy + rimDir.dy * r)}
            x2={n(cx + rimDir.dx * (r - rimSpan))}
            y2={n(cy + rimDir.dy * (r - rimSpan))}
          >
            <stop
              offset="0"
              stopColor={resolveColor(rim.color, palette)}
              stopOpacity={n(clamp(rim.opacity, 0, 1) * refAlpha(rim.color), 4)}
            />
            <stop offset="1" stopColor={resolveColor(rim.color, palette)} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {layer.rings.map((ring) => {
        const rr = Math.max(1, ring.radius * r)
        return (
          <path
            key={ring.id}
            d={arcPath(cx, cy, rr, Math.max(1, rr * clamp(ring.tilt, 0.02, 1)), ring.start, ring.sweep, ring.rotation)}
            fill="none"
            stroke={resolveColor(ring.color, palette)}
            strokeWidth={n(Math.max(0.1, ring.width))}
            strokeOpacity={n(clamp(ring.opacity, 0, 1) * refAlpha(ring.color), 4)}
            strokeLinecap="round"
            strokeDasharray={ring.dash > 0 ? `${n(ring.dash)} ${n(ring.dash * 1.6)}` : undefined}
          />
        )
      })}

      {layer.satellites.map((sat) => {
        const p = polar(cx, cy, sat.distance * r, sat.angle)
        const sr = Math.max(0.5, sat.size * r)
        const filled = sat.strokeWidth <= 0
        return (
          <circle
            key={sat.id}
            cx={n(p.x)}
            cy={n(p.y)}
            r={n(sr)}
            fill={filled ? resolveColor(sat.color, palette) : 'none'}
            fillOpacity={filled ? n(clamp(sat.opacity, 0, 1) * refAlpha(sat.color), 4) : undefined}
            stroke={filled ? undefined : resolveColor(sat.color, palette)}
            strokeWidth={filled ? undefined : n(sat.strokeWidth)}
            strokeOpacity={filled ? undefined : n(clamp(sat.opacity, 0, 1) * refAlpha(sat.color), 4)}
          />
        )
      })}

      {rim.enabled && (
        <g clipPath={`url(#${prefix}-planet-clip)`} style={blendStyle(rim.blend)}>
          <path
            d={crescentPath(cx, cy, r, rim.angle, -Math.max(0.001, rim.width) * r)}
            fillRule="evenodd"
            fill={`url(#${rimId})`}
          />
        </g>
      )}
    </Fragment>
  )
}

/* ---------- background ---------- */

function BackgroundView({ ctx }: { ctx: Ctx }) {
  const { doc, palette, prefix, canvas } = ctx
  const bg = doc.background
  const gradId = `${prefix}-bg-grad`
  const vignetteId = `${prefix}-bg-vignette`
  const vignette = clamp(bg.vignette, 0, 1)

  return (
    <Fragment>
      {bg.kind === 'solid' && (
        <rect
          x={n(canvas.x)}
          y={n(canvas.y)}
          width={n(canvas.w)}
          height={n(canvas.h)}
          fill={color(bg.color, palette)}
        />
      )}
      {bg.kind === 'gradient' && bg.gradient.type !== 'conic' && (
        <Fragment>
          <defs>
            <GradientDef id={gradId} gradient={bg.gradient} box={canvas} palette={palette} />
          </defs>
          <rect
            x={n(canvas.x)}
            y={n(canvas.y)}
            width={n(canvas.w)}
            height={n(canvas.h)}
            fill={`url(#${gradId})`}
          />
        </Fragment>
      )}
      {bg.kind === 'gradient' && bg.gradient.type === 'conic' && (
        <Fragment>
          <defs>
            <clipPath id={`${prefix}-bg-clip`}>
              <rect
                x={n(canvas.x)}
                y={n(canvas.y)}
                width={n(canvas.w)}
                height={n(canvas.h)}
              />
            </clipPath>
          </defs>
          <ConicSweep
            gradient={bg.gradient}
            box={canvas}
            palette={palette}
            clipId={`${prefix}-bg-clip`}
          />
        </Fragment>
      )}
      {vignette > 0.001 && (
        <Fragment>
          <defs>
            <radialGradient
              id={vignetteId}
              gradientUnits="userSpaceOnUse"
              cx={n(canvas.x + canvas.w / 2)}
              cy={n(canvas.y + canvas.h / 2)}
              r={n(Math.hypot(canvas.w, canvas.h) / 2)}
            >
              <stop offset="0.35" stopColor="#000000" stopOpacity="0" />
              <stop offset="0.78" stopColor="#000000" stopOpacity={n(vignette * 0.4, 4)} />
              <stop offset="1" stopColor="#000000" stopOpacity={n(vignette, 4)} />
            </radialGradient>
          </defs>
          <rect
            x={n(canvas.x)}
            y={n(canvas.y)}
            width={n(canvas.w)}
            height={n(canvas.h)}
            fill={`url(#${vignetteId})`}
          />
        </Fragment>
      )}
    </Fragment>
  )
}

/* ---------- root ---------- */

export function PlanetSvg({
  doc,
  palette,
  parsedById,
  transparent = false,
  idPrefix = 'pg',
  svgRef,
  className,
  style,
}: PlanetSvgProps) {
  const { width, height } = doc.canvas
  const canvas: Box = { x: 0, y: 0, w: width, h: height }
  const minSide = Math.min(width, height)
  const cx = doc.planet.cx * width
  const cy = doc.planet.cy * height
  const r = Math.max(1, (doc.planet.radius * minSide) / 2)
  const planetBox: Box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }

  const ctx: Ctx = { doc, palette, parsedById, prefix: idPrefix, cx, cy, r, canvas }
  const clipId = `${idPrefix}-planet-clip`
  const planetGradId = `${idPrefix}-planet-grad`
  const showBackground = !transparent && doc.background.kind !== 'transparent'

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${n(width)} ${n(height)}`}
      className={className}
      style={style}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={n(cx)} cy={n(cy)} r={n(r)} />
        </clipPath>
      </defs>

      {/* Tagged so the transparent-background export can drop it wholesale. */}
      {showBackground && (
        <g data-role="background">
          <BackgroundView ctx={ctx} />
        </g>
      )}

      {doc.planet.visible && doc.planet.mode === 'sliced' && <SlicedPlanet ctx={ctx} />}

      {doc.planet.visible && doc.planet.mode !== 'sliced' && (
        <Fragment>
          {doc.planet.gradient.type === 'conic' ? (
            <ConicSweep
              gradient={doc.planet.gradient}
              box={planetBox}
              palette={palette}
              clipId={clipId}
            />
          ) : (
            <Fragment>
              <defs>
                <GradientDef
                  id={planetGradId}
                  gradient={doc.planet.gradient}
                  box={planetBox}
                  palette={palette}
                />
              </defs>
              <circle cx={n(cx)} cy={n(cy)} r={n(r)} fill={`url(#${planetGradId})`} />
            </Fragment>
          )}
        </Fragment>
      )}

      {doc.layers.map((layer) => {
        if (!layer.visible) return null
        if (layer.kind === 'pattern') {
          return <PatternLayerView key={layer.id} layer={layer} ctx={ctx} />
        }
        if (layer.kind === 'shading') {
          return doc.planet.visible ? (
            <ShadingLayerView key={layer.id} layer={layer} ctx={ctx} />
          ) : null
        }
        return <AccentLayerView key={layer.id} layer={layer} ctx={ctx} />
      })}

      {doc.planet.visible && doc.planet.stroke.enabled && (
        <circle
          cx={n(cx)}
          cy={n(cy)}
          r={n(r)}
          fill="none"
          stroke={resolveColor(doc.planet.stroke.color, palette)}
          strokeWidth={n(Math.max(0.1, doc.planet.stroke.width))}
          strokeOpacity={n(clamp(doc.planet.stroke.opacity, 0, 1), 4)}
        />
      )}
    </svg>
  )
}
