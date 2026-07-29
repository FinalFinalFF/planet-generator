/**
 * Export. The live <svg> is the source of truth: SVG export is a direct
 * serialization of that node, and PNG export rasterizes the same string, so
 * what you see is what lands on disk.
 */

export type ExportOptions = {
  /** Drop the background layer and leave the canvas clear. */
  transparent: boolean
}

function safeFilePart(s: string): string {
  return (s || 'planet').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^-|-$)/g, '')
}

export function planetFilename(seed: string, ext: string, suffix = ''): string {
  return `planet-${safeFilePart(seed)}${suffix ? `-${suffix}` : ''}.${ext}`
}

/** Clone the live SVG into a self-contained, standalone document string. */
export function serializeSvg(source: SVGSVGElement, opts: ExportOptions): string {
  const clone = source.cloneNode(true) as SVGSVGElement

  if (opts.transparent) {
    clone.querySelectorAll('[data-role="background"]').forEach((el) => el.remove())
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
