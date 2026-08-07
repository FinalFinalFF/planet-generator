/**
 * Export. The live <svg> is the source of truth: SVG export is a direct
 * serialization of that node, and PNG export rasterizes the same string, so
 * what you see is what lands on disk.
 */

export type ExportOptions = {
  /** Drop the background layer and leave the canvas clear. */
  transparent: boolean
  /**
   * Replace `<pattern>` tile fills with the equivalent repeated geometry.
   *
   * The `<pattern>` form is correct SVG and renders in every browser, but
   * design-tool importers commonly ignore pattern fills — Figma drops them
   * outright, which silently leaves the bare gradient with no texture. Expanding
   * costs file size but survives everywhere.
   */
  expandPatterns?: boolean
  /** Refuse to expand a layer that would need more tiles than this. */
  maxTiles?: number
  /** Told about anything the export had to compromise on. */
  onNote?: (message: string, isWarning: boolean) => void
}

const DEFAULT_MAX_TILES = 900
/**
 * Tile count alone is a poor guard: the source patterns range from ~12 kB to
 * ~330 kB of markup, so 900 copies of the largest would be a 300 MB file.
 */
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024

/** Elements that define something by id and never render where they sit. */
const DEF_TAGS =
  'defs, clipPath, mask, linearGradient, radialGradient, pattern, filter, symbol, marker'

/**
 * Rewrite `<rect fill="url(#somePattern)">` into the tiles that pattern would
 * have painted.
 *
 * This is the one place export is not a byte-for-byte serialization of the live
 * node, and it is deliberate: the rewrite is mechanical and equivalence
 * preserving — same geometry, same paint, just stamped explicitly instead of
 * left to the renderer's tiling.
 */
function expandPatternFills(
  clone: SVGSVGElement,
  live: SVGSVGElement,
  maxTiles: number,
): { expanded: number; skipped: number } {
  let expanded = 0
  let skipped = 0

  const filled = Array.from(clone.querySelectorAll('rect[fill^="url(#"]'))
  for (const rect of filled) {
    const ref = rect.getAttribute('fill') ?? ''
    const id = ref.slice(5, -1) // url(#ID)
    const pattern = clone.querySelector(`pattern[id="${CSS.escape(id)}"]`)
    if (!pattern) continue

    const tileW = parseFloat(pattern.getAttribute('width') ?? '0')
    const tileH = parseFloat(pattern.getAttribute('height') ?? '0')
    if (!(tileW > 0 && tileH > 0)) continue

    // Read the tile→user matrix off the live element: a detached clone has no
    // presentation context, so its transform list may not be resolved.
    const livePattern = live.querySelector(`pattern[id="${CSS.escape(id)}"]`)
    const consolidated = (livePattern as SVGPatternElement | null)?.patternTransform?.baseVal?.consolidate()
    const m = consolidated
      ? new DOMMatrix([
          consolidated.matrix.a,
          consolidated.matrix.b,
          consolidated.matrix.c,
          consolidated.matrix.d,
          consolidated.matrix.e,
          consolidated.matrix.f,
        ])
      : new DOMMatrix()

    // Which tiles touch the filled rect? Map its corners back into tile space.
    const x = parseFloat(rect.getAttribute('x') ?? '0')
    const y = parseFloat(rect.getAttribute('y') ?? '0')
    const w = parseFloat(rect.getAttribute('width') ?? '0')
    const h = parseFloat(rect.getAttribute('height') ?? '0')
    const inv = m.inverse()
    const corners = [
      inv.transformPoint(new DOMPoint(x, y)),
      inv.transformPoint(new DOMPoint(x + w, y)),
      inv.transformPoint(new DOMPoint(x, y + h)),
      inv.transformPoint(new DOMPoint(x + w, y + h)),
    ]
    const minI = Math.floor(Math.min(...corners.map((p) => p.x)) / tileW)
    const maxI = Math.ceil(Math.max(...corners.map((p) => p.x)) / tileW)
    const minJ = Math.floor(Math.min(...corners.map((p) => p.y)) / tileH)
    const maxJ = Math.ceil(Math.max(...corners.map((p) => p.y)) / tileH)

    const count = (maxI - minI) * (maxJ - minJ)
    const tileBytes = pattern.innerHTML.length
    if (
      !Number.isFinite(count) ||
      count <= 0 ||
      count > maxTiles ||
      count * tileBytes > MAX_EXPANDED_BYTES
    ) {
      skipped++
      continue
    }

    const svgNS = 'http://www.w3.org/2000/svg'
    // One reusable clip in tile space; `<pattern>` clips tile content to the
    // tile, and several source patterns do overhang their viewBox.
    const clipId = `${id}-tile`
    let clip = clone.querySelector(`clipPath[id="${CSS.escape(clipId)}"]`)
    if (!clip) {
      clip = document.createElementNS(svgNS, 'clipPath')
      clip.setAttribute('id', clipId)
      const cr = document.createElementNS(svgNS, 'rect')
      cr.setAttribute('width', String(tileW))
      cr.setAttribute('height', String(tileH))
      clip.appendChild(cr)
      pattern.parentNode?.insertBefore(clip, pattern)
    }

    // Hoist every id-bearing *definition* out of the tile before cloning.
    // Cloning them per tile would repeat their ids, and only the first of a
    // duplicated id resolves. Not just `<defs>`: these Figma exports put
    // `<mask>` and `<clipPath>` inline in the content too.
    //
    // Safe to move out of an enclosing transform — none of these render in
    // place, and `userSpaceOnUse` geometry resolves against the *referencing*
    // element's space, so one hoisted copy serves every tile. Their ids are
    // namespaced per pattern instance, so two layers of the same pattern
    // hoisting into one <defs> do not collide.
    for (const def of Array.from(pattern.querySelectorAll(DEF_TAGS))) {
      pattern.parentNode?.insertBefore(def, pattern)
    }

    // Anything left carrying an id is renderable, so it cannot be hoisted and
    // would duplicate once per tile. Bail rather than emit duplicate ids.
    if (pattern.querySelector('[id]')) {
      skipped++
      continue
    }

    const host = document.createElementNS(svgNS, 'g')
    // The rect may carry the lens mask; keep it on the replacement.
    const mask = rect.getAttribute('mask')
    if (mask) host.setAttribute('mask', mask)

    const baseTransform = pattern.getAttribute('patternTransform') ?? ''
    for (let i = minI; i < maxI; i++) {
      for (let j = minJ; j < maxJ; j++) {
        const tile = document.createElementNS(svgNS, 'g')
        tile.setAttribute(
          'transform',
          `${baseTransform} translate(${i * tileW} ${j * tileH})`.trim(),
        )
        const inner = document.createElementNS(svgNS, 'g')
        inner.setAttribute('clip-path', `url(#${clipId})`)
        for (const child of Array.from(pattern.childNodes)) {
          inner.appendChild(child.cloneNode(true))
        }
        tile.appendChild(inner)
        host.appendChild(tile)
      }
    }

    rect.parentNode?.replaceChild(host, rect)
    pattern.remove()
    expanded++
  }

  return { expanded, skipped }
}

function safeFilePart(s: string): string {
  return (s || 'orb').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^-|-$)/g, '')
}

export function orbFilename(seed: string, ext: string, suffix = ''): string {
  return `orb-${safeFilePart(seed)}${suffix ? `-${suffix}` : ''}.${ext}`
}

/** Clone the live SVG into a self-contained, standalone document string. */
export function serializeSvg(source: SVGSVGElement, opts: ExportOptions): string {
  const clone = source.cloneNode(true) as SVGSVGElement

  if (opts.transparent) {
    clone.querySelectorAll('[data-role="background"]').forEach((el) => el.remove())
  }
  if (opts.expandPatterns) {
    const { expanded, skipped } = expandPatternFills(
      clone,
      source,
      opts.maxTiles ?? DEFAULT_MAX_TILES,
    )
    if (skipped > 0) {
      opts.onNote?.(
        `${skipped} pattern layer${skipped === 1 ? '' : 's'} needed too many tiles to expand — ` +
          `left as a <pattern> fill, which some design tools ignore. Try a larger pattern scale.`,
        true,
      )
    } else if (expanded > 0) {
      opts.onNote?.(`Expanded ${expanded} pattern layer${expanded === 1 ? '' : 's'} to geometry`, false)
    }
  }

  // Editor-only bookkeeping has no business in the exported file.
  clone.querySelectorAll('[data-role]').forEach((el) => el.removeAttribute('data-role'))
  clone.removeAttribute('class')
  clone.removeAttribute('style')

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const body = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`
}

/**
 * Rasterize an SVG string. `targetLongEdge` sets the long edge in device
 * pixels; the SVG is re-sized before rasterization so the vector is redrawn at
 * full resolution rather than upscaled.
 */
export async function rasterizeSvg(
  svgText: string,
  width: number,
  height: number,
  targetLongEdge: number,
  transparent: boolean,
): Promise<Blob> {
  const longEdge = Math.max(width, height)
  const factor = targetLongEdge / longEdge
  const outW = Math.max(1, Math.round(width * factor))
  const outH = Math.max(1, Math.round(height * factor))

  // Re-declare the intrinsic size so the rasterizer draws at the target scale.
  const sized = svgText
    .replace(/(<svg\b[^>]*?)\swidth="[^"]*"/, '$1')
    .replace(/(<svg\b[^>]*?)\sheight="[^"]*"/, '$1')
    .replace(/<svg\b/, `<svg width="${outW}" height="${outH}"`)

  const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'sync'
    img.src = url
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not rasterize the SVG'))
    })
    if (typeof img.decode === 'function') {
      try {
        await img.decode()
      } catch {
        // Safari can reject decode() on blob-backed SVG; onload already fired.
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    if (!transparent) {
      // The serialized SVG already carries the background; this only guards
      // against a fully transparent doc rasterizing to nothing usable.
      ctx.clearRect(0, 0, outW, outH)
    }
    ctx.drawImage(img, 0, 0, outW, outH)

    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!out) throw new Error('PNG encoding failed')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the navigation a tick before revoking, or Safari cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(text: string, filename: string, type = 'image/svg+xml'): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename)
}
