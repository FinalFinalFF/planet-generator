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
  type OrbDoc,
  type SectorFill,
  type ShadingLayer,
} from '../types'
import { DEFAULT_LAYER_MASK } from '../lib/defaults'
import { usePhotos, type Photo } from '../lib/photos'
import { refAlpha, resolveColor, slotsByLightness } from '../lib/palettes'
import { clamp, luminance, mixHex, withAlpha } from '../lib/color'
import {
  arcPath,
  crescentPath,
  dirFromAngle,
  circleRectIntersectionBBox,
  circleRectIntersectionPath,
  linearEndpoints,
  n,
  polar,
  rotateAbout,
  rowEdges,
  wedgePath,
  type Box,
} from '../lib/geometry'
import { recolor, resolveTokens, type GroupPaint } from '../lib/patterns/registry'
import type { ParsedPattern } from '../lib/patterns/parse'

export type OrbSvgProps = {
  doc: OrbDoc
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
  doc: OrbDoc
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  photosById: Map<string, Photo>
  prefix: string
  /** Orb center + radius in user units. */
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

/**
 * The flat ink a gradient collapses to under `doc.solidFills`: its own ramp
 * sampled at the midpoint, so the substitute stays palette-driven and close to
 * the gradient's overall read rather than grabbing one end of it.
 */
function solidFor(g: Gradient, palette: Palette): string {
  const s = sampleGradient(g, palette, 0.5)
  return withAlpha(s.hex, s.alpha)
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

/* ---------- sector collage ---------- */

/**
 * Area centroid of a sector cell (the unrotated rect ∩ the disc), rotated
 * into place. Sampled on a grid rather than integrated: it only aims a photo's
 * focal point, so a fraction of a percent is plenty, and sampling has no
 * special cases for which rect edges the circle crosses.
 */
function cellCentroid(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  angle: number,
): { x: number; y: number } {
  const N = 32
  let sx = 0
  let sy = 0
  let count = 0
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = x0 + ((i + 0.5) / N) * (x1 - x0)
      const y = y0 + ((j + 0.5) / N) * (y1 - y0)
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
      sx += x
      sy += y
      count++
    }
  }
  if (count === 0) return rotateAbout((x0 + x1) / 2, (y0 + y1) / 2, angle, cx, cy)
  return rotateAbout(sx / count, sy / count, angle, cx, cy)
}

/** A SectorFill ramp as a throwaway two-stop Gradient, for GradientDef. */
function rampGradient(fill: Extract<SectorFill, { kind: 'ramp' }>): Gradient {
  return {
    type: 'linear',
    angle: fill.angle,
    stops: [
      { id: 'a', offset: 0, color: fill.from },
      { id: 'b', offset: 1, color: fill.to },
    ],
    focusX: 0.5,
    focusY: 0.5,
    radius: 0.75,
    segments: 180,
  }
}

/**
 * The abstract sector collage: one chord splits the disc into two rows, each
 * row splits crosswise into 1–3 evenly sized cells, and every cell paints
 * independently with a hard edge.
 *
 * Geometry lives in a frame where the chord is horizontal: each cell is an
 * axis-aligned rect there, intersected with the disc and rotated into place in
 * JS (`circleRectIntersectionPath`). Flat and ramp cells paint that exact path
 * with no clip at all — so a Figma import gets one plain named shape per cell
 * instead of a mask group. Texture cells need one clip, holding the same path.
 * Never a nested clip (orb ∩ cell): Chrome mis-rasterizes nested clip-path
 * intersections when the host <svg> is CSS-scaled, which is exactly how the
 * editor stage and the batch cells render. Ramp gradients stay in absolute
 * canvas space, so a ramp's angle means the same thing in every cell
 * regardless of `angle`.
 */
function SectorOrb({ ctx }: { ctx: Ctx }) {
  const { cx, cy, r, prefix, palette, doc } = ctx
  const s = doc.orb.sectors
  const orbBox: Box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }
  const pad = r * 2.2
  const chordY = cy + clamp(s.offset, -0.95, 0.95) * r

  const rows: SectorFill[][] = [s.rowA, s.rowB].map((row) =>
    row.length ? row.slice(0, 3) : [{ kind: 'flat', color: { slot: 0 } }],
  )

  const defs: React.ReactNode[] = []
  const cells: React.ReactNode[] = []
  const textured: React.ReactNode[] = []
  rows.forEach((row, ri) => {
    const y0 = ri === 0 ? cy - pad : chordY
    const y1 = ri === 0 ? chordY : cy + pad
    row.forEach((fill, ci) => {
      const edges = rowEdges(row.length, ri === 0 ? s.widthsA : s.widthsB)
      const x0 = ci === 0 ? cx - pad : cx - r + 2 * r * edges[ci]
      const x1 = ci === row.length - 1 ? cx + pad : cx - r + 2 * r * edges[ci + 1]

      // Clamp outer overhangs to just past the circle so the intersection
      // walk works with tame numbers; never clamp *inside* the circle, or
      // the clamp itself would change the intersection.
      const m = r * 1.05
      const gx0 = Math.max(x0, cx - m)
      const gx1 = Math.min(x1, cx + m)
      const gy0 = Math.max(y0, cy - m)
      const gy1 = Math.min(y1, cy + m)
      const cellD = circleRectIntersectionPath(cx, cy, r, gx0, gy0, gx1, gy1, s.angle)
      if (!cellD) return // chord pushed the cell entirely off the disc
      const cellName = `Sector ${ri === 0 ? 'A' : 'B'}${ci + 1}`

      if (fill.kind === 'photo') {
        const photo = ctx.photosById.get(fill.photoId)
        if (!photo) return // library not loaded yet, or the photo was deleted
        // Painted as the cell's own path with an *image fill* — no clip. The
        // fill is the structure Figma's own SVG export uses for an image-
        // filled shape (an objectBoundingBox <pattern> holding a <use> of an
        // <image>), which its importer turns back into one shape with an
        // image fill. A clipPath around an <image> came into Figma mis-masked
        // (photo cut to a vertical strip of its cell, 2026-10-13).
        //
        // Cover-fit over the cell's exact bounding box; the photo's focal
        // point aims at the cell's centroid — not a fraction of the box,
        // which for a wedge can land outside the visible shape — clamped so
        // the photo still covers the box. The photo stays upright whatever
        // the structure's angle: it is a picture, not a texture.
        const box = circleRectIntersectionBBox(cx, cy, r, gx0, gy0, gx1, gy1, s.angle)
        if (!box) return
        const bw = Math.max(1, box.w)
        const bh = Math.max(1, box.h)
        // Zoom in only as far as needed (at most 1.6× the cover size) for the
        // focal point to land within a quarter of the cell's size of its
        // centroid without exposing an edge. Plain cover size let the edge
        // clamp slide subjects to the cut in long thin cells; zooming to the
        // exact centroid (first try, cap 3×) blew faces up to fill the cell.
        const c = cellCentroid(cx, cy, r, gx0, gy0, gx1, gy1, s.angle)
        const fx = clamp(fill.focusX, 0.001, 0.999)
        const fy = clamp(fill.focusY, 0.001, 0.999)
        const SLACK = 0.25
        const kCover = Math.max(bw / photo.width, bh / photo.height) * clamp(fill.zoom, 1, 8)
        const kNeeded = Math.max(
          (c.x - SLACK * bw - box.x) / (photo.width * fx),
          (box.x + bw - (c.x + SLACK * bw)) / (photo.width * (1 - fx)),
          (c.y - SLACK * bh - box.y) / (photo.height * fy),
          (box.y + bh - (c.y + SLACK * bh)) / (photo.height * (1 - fy)),
        )
        const k = Math.max(kCover, Math.min(kNeeded, kCover * 1.6))
        const w = photo.width * k
        const h = photo.height * k
        const px = clamp(c.x - w * clamp(fill.focusX, 0, 1), box.x + bw - w, box.x)
        const py = clamp(c.y - h * clamp(fill.focusY, 0, 1), box.y + bh - h, box.y)
        const patId = `${prefix}-phfill-${ri}-${ci}`
        const imgId = `${prefix}-phimg-${ri}-${ci}`
        defs.push(
          <pattern key={patId} id={patId} patternContentUnits="objectBoundingBox" width="1" height="1">
            <use
              xlinkHref={`#${imgId}`}
              // Image pixels → fractions of the cell's bounding box.
              transform={`matrix(${n(k / bw, 8)} 0 0 ${n(k / bh, 8)} ${n((px - box.x) / bw, 6)} ${n((py - box.y) / bh, 6)})`}
            />
          </pattern>,
          <image
            key={imgId}
            id={imgId}
            width={photo.width}
            height={photo.height}
            preserveAspectRatio="none"
            // xlink:href rather than href: older importers (Illustrator,
            // some Figma paths) only read the xlink form.
            xlinkHref={photo.dataUrl}
          />,
        )
        cells.push(
          <path key={`ph-${ri}-${ci}`} data-name={`${cellName} ${photo.name}`} d={cellD} fill={`url(#${patId})`} />,
        )
        return
      }

      if (fill.kind === 'texture') {
        const parsed = ctx.parsedById.get(fill.patternId)
        if (!parsed) return // not parsed yet; the cell paints once it loads

        const paints: GroupPaint[] = parsed.groups.map((g) => {
          const ref = fill.colors[g.index]
          return { hex: resolveColor(ref ?? { slot: g.index }, palette), alpha: refAlpha(ref) }
        })
        const markup = recolor(
          parsed,
          resolveTokens(parsed, paints),
          `${prefix}-sec-${ri}-${ci}`,
        )
        // Cover-fit over the cell's visible box: sized to its diagonal so any
        // texture rotation still covers, centered on the box's rotated center.
        // Scale never drops below 1 here: below it the tile stopped covering
        // the cell, which showed as offset plate edges and gaps once every
        // texture cell carried an opaque plate (2026-10-13).
        const bw = Math.max(1, gx1 - gx0)
        const bh = Math.max(1, gy1 - gy0)
        const bc = rotateAbout((gx0 + gx1) / 2, (gy0 + gy1) / 2, s.angle, cx, cy)
        const k = (Math.hypot(bw, bh) * Math.max(1, fill.scale)) /
          Math.min(parsed.width, parsed.height)
        const transform =
          `translate(${n(bc.x)} ${n(bc.y)}) rotate(${n(fill.rotation)}) ` +
          `scale(${n(k, 5)}) translate(${n(-parsed.width / 2)} ${n(-parsed.height / 2)})`
        // An alpha <mask> holding the exact cell∩circle path — the form
        // Figma's own SVG export writes for a masked group, which its importer
        // round-trips. The equivalent clipPath imported mis-masked (a texture
        // cut off along a vertical edge that was not the cell's, 2026-10-13).
        // One level, never nested — see the component comment.
        const maskId = `${prefix}-secmask-${ri}-${ci}`
        defs.push(
          <mask
            key={maskId}
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={n(ctx.canvas.x)}
            y={n(ctx.canvas.y)}
            width={n(ctx.canvas.w)}
            height={n(ctx.canvas.h)}
            style={{ maskType: 'alpha' }}
          >
            <path d={cellD} fill="#ffffff" />
          </mask>,
        )
        // Every texture cell paints a ground — the exact cell shape — before
        // its artwork: the plate's own color when it has a visible one, else
        // the palette end its inks are not. Some patterns' artwork stops short
        // of their tile edge, and a pattern with no plate (5 of the library)
        // has nothing behind its ink; either way a gap read as a hole.
        const plateGroup = parsed.groups.find((g) => g.isBackground)
        const platePaint = plateGroup ? paints[plateGroup.index] : undefined
        let ground: string | null = null
        if (platePaint && platePaint.alpha > 0.001) {
          ground = withAlpha(platePaint.hex, platePaint.alpha)
        } else if (!plateGroup) {
          const visible = paints.filter((p) => p.alpha > 0.001)
          const meanL = visible.length ? visible.reduce((acc, p) => acc + luminance(p.hex), 0) / visible.length : 1
          const order = slotsByLightness(palette)
          ground = resolveColor({ slot: meanL > 0.5 ? order[0] : order[order.length - 1] }, palette)
        }
        textured.push(
          <g
            key={`tx-${ri}-${ci}`}
            mask={`url(#${maskId})`}
            data-name={`${cellName} ${parsed.name}`}
          >
            {ground && <path d={cellD} fill={ground} data-name="Ground" />}
            <g transform={transform} dangerouslySetInnerHTML={{ __html: markup }} />
          </g>,
        )
        return
      }

      const gradId = `${prefix}-secg-${ri}-${ci}`
      // Under solid fills a ramp cell collapses to its midpoint ink, same as
      // every other gradient in the document.
      const rampSolid = fill.kind === 'ramp' && doc.solidFills
      if (fill.kind === 'ramp' && !rampSolid) {
        defs.push(
          <GradientDef
            key={gradId}
            id={gradId}
            gradient={rampGradient(fill)}
            box={orbBox}
            palette={palette}
          />,
        )
      }
      cells.push(
        <path
          key={`${ri}-${ci}`}
          data-name={cellName}
          d={cellD}
          fill={
            fill.kind === 'flat'
              ? color(fill.color, palette)
              : rampSolid
                ? solidFor(rampGradient(fill as Extract<SectorFill, { kind: 'ramp' }>), palette)
                : `url(#${gradId})`
          }
        />,
      )
    })
  })

  return (
    <Fragment>
      {defs.length > 0 && <defs>{defs}</defs>}
      <g data-name="Sector cells">{cells}</g>
      {textured}
    </Fragment>
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
  const useMask = mask.mode !== 'orb'
  const paints: GroupPaint[] = parsed.groups.map((g) => {
    const ref = layer.colors[g.index]
    return { hex: resolveColor(ref ?? { slot: g.index }, palette), alpha: refAlpha(ref) }
  })
  // Unique per layer and per host <svg>, so two layers on the same pattern — or
  // the editor preview alongside a batch cell — cannot share internal ids.
  const markup = recolor(parsed, resolveTokens(parsed, paints), `${prefix}-${layer.id}`)
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
          clipPath={`url(#${prefix}-orb-clip)`}
          opacity={n(layer.opacity, 4)}
          style={blendStyle(layer.blend)}
          data-name={`Pattern ${layer.name}`}
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
        clipPath={`url(#${prefix}-orb-clip)`}
        opacity={n(layer.opacity, 4)}
        style={blendStyle(layer.blend)}
        data-name={`Pattern ${layer.name}`}
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
          blending against the orb underneath. */}
      <g clipPath={`url(#${prefix}-orb-clip)`} style={blendStyle(layer.blend)} data-name="Shading">
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
  /*
   * The crescent rim light is the one part of the accent layer that is a 3D cue
   * — it reads as light wrapping a sphere's limb — so flat mode drops it while
   * rings and satellites stay. Its gradient def goes with it: leaving an unused
   * def behind would put dead markup in every export.
   */
  const showRim = rim.enabled && !ctx.doc.flat

  return (
    <Fragment>
      {showRim && (
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
            data-name="Ring"
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
            data-name="Satellite"
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

      {showRim && (
        <g clipPath={`url(#${prefix}-orb-clip)`} style={blendStyle(rim.blend)} data-name="Rim light">
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
  // Solid fills retires the vignette too: it is a smooth radial blend, and
  // smooth blends are exactly what the toggle exists to remove. (Flat mode
  // keeps it — that toggle is about sphere cues, this one about gradients.)
  const vignette = doc.solidFills ? 0 : clamp(bg.vignette, 0, 1)

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
      {bg.kind === 'gradient' && doc.solidFills && (
        <rect
          x={n(canvas.x)}
          y={n(canvas.y)}
          width={n(canvas.w)}
          height={n(canvas.h)}
          fill={solidFor(bg.gradient, palette)}
        />
      )}
      {bg.kind === 'gradient' && !doc.solidFills && bg.gradient.type !== 'conic' && (
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
      {bg.kind === 'gradient' && !doc.solidFills && bg.gradient.type === 'conic' && (
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
      {/*
       * The vignette survives flat mode. It darkens the canvas corners, not the
       * orb: it is a background treatment that would look the same behind a
       * square, so it never implies a sphere. Flat mode suppresses sphere
       * shading, not every soft gradient in the document.
       */}
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
            data-name="Vignette"
          />
        </Fragment>
      )}
    </Fragment>
  )
}

/* ---------- root ---------- */

export function OrbSvg({
  doc,
  palette,
  parsedById,
  transparent = false,
  idPrefix = 'pg',
  svgRef,
  className,
  style,
}: OrbSvgProps) {
  const { width, height } = doc.canvas
  const canvas: Box = { x: 0, y: 0, w: width, h: height }
  const minSide = Math.min(width, height)
  const cx = doc.orb.cx * width
  const cy = doc.orb.cy * height
  const r = Math.max(1, (doc.orb.radius * minSide) / 2)
  const orbBox: Box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }

  const photosById = usePhotos()
  const ctx: Ctx = { doc, palette, parsedById, photosById, prefix: idPrefix, cx, cy, r, canvas }
  const clipId = `${idPrefix}-orb-clip`
  const orbGradId = `${idPrefix}-orb-grad`
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
        <g data-role="background" data-name="Background">
          <BackgroundView ctx={ctx} />
        </g>
      )}

      {doc.orb.visible && doc.orbType === 'segments' && <SectorOrb ctx={ctx} />}

      {doc.orb.visible && doc.orbType !== 'segments' && doc.solidFills && (
        // Solid fills: the disc gradient collapses to its mid-ramp ink. The
        // gradient itself is untouched, so toggling this off restores it.
        <circle cx={n(cx)} cy={n(cy)} r={n(r)} fill={solidFor(doc.orb.gradient, palette)} data-name="Orb disc" />
      )}
      {doc.orb.visible && doc.orbType !== 'segments' && !doc.solidFills && (
        <Fragment>
          {doc.orb.gradient.type === 'conic' ? (
            <ConicSweep
              gradient={doc.orb.gradient}
              box={orbBox}
              palette={palette}
              clipId={clipId}
            />
          ) : (
            <Fragment>
              <defs>
                <GradientDef
                  id={orbGradId}
                  gradient={doc.orb.gradient}
                  box={orbBox}
                  palette={palette}
                />
              </defs>
              <circle cx={n(cx)} cy={n(cy)} r={n(r)} fill={`url(#${orbGradId})`} data-name="Orb disc" />
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
          // Flat mode outranks the layer's own `visible` and any composition
          // style that set it — suppressed here rather than by rewriting the
          // layer, so the user's shading settings survive toggling flat off.
          return doc.orb.visible && !doc.flat ? (
            <ShadingLayerView key={layer.id} layer={layer} ctx={ctx} />
          ) : null
        }
        return <AccentLayerView key={layer.id} layer={layer} ctx={ctx} />
      })}

      {doc.orb.visible && doc.orb.stroke.enabled && (
        <circle
          data-name="Outline"
          cx={n(cx)}
          cy={n(cy)}
          r={n(r)}
          fill="none"
          stroke={resolveColor(doc.orb.stroke.color, palette)}
          strokeWidth={n(Math.max(0.1, doc.orb.stroke.width))}
          strokeOpacity={n(clamp(doc.orb.stroke.opacity, 0, 1), 4)}
        />
      )}
    </svg>
  )
}
