/**
 * Turns a raw pattern SVG into a recolorable template.
 *
 * The pipeline:
 *   1. parse with DOMParser and read the viewBox (the tile box)
 *   2. walk every drawable element, skipping <mask>/<clipPath>/<pattern>
 *      subtrees — colors in there are structural (luminance masks would break
 *      if we recolored their white)
 *   3. swap each literal color for a `%%cN%%` token and record the occurrence
 *   4. cluster the unique colors in OKLab into a handful of assignable groups
 *   5. detect the full-bleed background plate most of these exports start with
 *   6. namespace every id so many patterns can coexist in one <defs>
 *
 * The result is a template string; recoloring is then a single string pass.
 */

import { hexToLab, isColorLiteral, labDistance, normalizeHex, type Lab } from '../color'

export type ColorGroup = {
  /** Stable index; 0 is the background plate when one was detected. */
  index: number
  label: string
  /** Representative original color, shown as a chip in the UI. */
  sample: string
  /** True for the full-bleed plate the artwork sits on. */
  isBackground: boolean
  /** Token indices that belong to this group. */
  tokens: number[]
  /** Mean OKLab lightness of the group's members. */
  meanL: number
  /** How many attributes across the file this group covers. */
  weight: number
}

export type ParsedPattern = {
  id: string
  name: string
  /** Tile box in source units. */
  width: number
  height: number
  /** Serialized inner markup with `%%cN%%` color tokens. */
  template: string
  /** Original color per token index. */
  tokenColors: string[]
  /** OKLab lightness per token index. */
  tokenL: number[]
  groups: ColorGroup[]
  /** Group index per token index. */
  tokenGroup: number[]
}

const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'] as const
const SKIP_TAGS = new Set(['mask', 'clippath', 'pattern', 'marker', 'filter'])
const DRAWABLE_TAGS = new Set([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use',
])
const MAX_GROUPS = 8
const MERGE_THRESHOLD = 0.085

/* ---------- geometry helpers ---------- */

type Box = { x: number; y: number; w: number; h: number }

/**
 * True when `d` is a single rectilinear subpath spanning (near) the whole box.
 * Deliberately conservative: anything with curves, relative commands, or more
 * than one `M` is not a background plate.
 */
function pathIsFullBleed(d: string, box: Box): boolean {
  if (/[CcSsQqTtAamlhvz]/.test(d)) return false
  const mCount = (d.match(/M/g) ?? []).length
  if (mCount !== 1) return false

  let x = 0
  let y = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const track = () => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  const tokens = d.match(/[MLHVZ]|-?[\d.]+(?:e-?\d+)?/gi) ?? []
  let cmd = ''
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/[MLHVZ]/i.test(t) && t.length === 1) {
      cmd = t.toUpperCase()
      i++
      if (cmd === 'Z') track()
      continue
    }
    const n = parseFloat(t)
    if (Number.isNaN(n)) return false
    if (cmd === 'M' || cmd === 'L') {
      const n2 = parseFloat(tokens[i + 1] ?? '')
      if (Number.isNaN(n2)) return false
      x = n
      y = n2
      i += 2
    } else if (cmd === 'H') {
      x = n
      i += 1
    } else if (cmd === 'V') {
      y = n
      i += 1
    } else {
      return false
    }
    track()
  }
  if (!Number.isFinite(minX)) return false
  const coversX = maxX - minX >= box.w * 0.97
  const coversY = maxY - minY >= box.h * 0.97
  return coversX && coversY
}

function rectIsFullBleed(el: Element, box: Box): boolean {
  const num = (name: string, fallback = 0) => {
    const v = el.getAttribute(name)
    if (v == null) return fallback
    const n = parseFloat(v)
    return Number.isNaN(n) ? fallback : n
  }
  return num('width') >= box.w * 0.97 && num('height') >= box.h * 0.97
}

/* ---------- style attribute handling ---------- */

function readStyleColors(style: string): Array<{ prop: string; value: string }> {
  const out: Array<{ prop: string; value: string }> = []
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if ((COLOR_ATTRS as readonly string[]).includes(prop) && isColorLiteral(value)) {
      out.push({ prop, value })
    }
  }
  return out
}

function writeStyleColors(style: string, replace: (prop: string, value: string) => string | null): string {
  return style
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':')
      if (idx < 0) return decl
      const prop = decl.slice(0, idx).trim().toLowerCase()
      const value = decl.slice(idx + 1).trim()
      const next = replace(prop, value)
      return next == null ? decl : `${decl.slice(0, idx)}:${next}`
    })
    .join(';')
}

/* ---------- clustering ---------- */

type Cluster = { members: number[]; centroid: Lab; weight: number }

function clusterColors(colors: string[], weights: number[]): Cluster[] {
  const labs = colors.map(hexToLab)
  let clusters: Cluster[] = colors.map((_, i) => ({
    members: [i],
    centroid: labs[i],
    weight: weights[i],
  }))

  const centroidOf = (members: number[]): Lab => {
    let L = 0
    let a = 0
    let b = 0
    for (const m of members) {
      L += labs[m].L
      a += labs[m].a
      b += labs[m].b
    }
    const n = members.length
    return { L: L / n, a: a / n, b: b / n }
  }

  // Merge the closest pair until we are under the cap and no pair is closer
  // than the perceptual threshold.
  for (let guard = 0; guard < 512 && clusters.length > 1; guard++) {
    let bestI = -1
    let bestJ = -1
    let bestD = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = labDistance(clusters[i].centroid, clusters[j].centroid)
        if (d < bestD) {
          bestD = d
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0) break
    const mustShrink = clusters.length > MAX_GROUPS
    if (!mustShrink && bestD > MERGE_THRESHOLD) break
    const members = [...clusters[bestI].members, ...clusters[bestJ].members]
    const weight = clusters[bestI].weight + clusters[bestJ].weight
    clusters = clusters.filter((_, k) => k !== bestI && k !== bestJ)
    clusters.push({ members, centroid: centroidOf(members), weight })
  }
  return clusters
}

/* ---------- id namespacing ---------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namespaceIds(markup: string, ns: string): string {
  const ids = new Set<string>()
  for (const m of markup.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1])
  let out = markup
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    const e = escapeRe(id)
    out = out
      .replace(new RegExp(`\\bid="${e}"`, 'g'), `id="${ns}-${id}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, 'g'), `url(#${ns}-${id})`)
      .replace(new RegExp(`(\\bhref=")#${e}"`, 'g'), `$1#${ns}-${id}"`)
  }
  return out
}

/* ---------- main ---------- */

export function parsePatternSvg(id: string, name: string, raw: string): ParsedPattern {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error(`${name}: not an SVG document`)
  }

  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  let box: Box
  if (vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
    box = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
  } else {
    box = {
      x: 0,
      y: 0,
      w: parseFloat(root.getAttribute('width') ?? '1000') || 1000,
      h: parseFloat(root.getAttribute('height') ?? '1000') || 1000,
    }
  }

  const tokenColors: string[] = []
  const tokenIndex = new Map<string, number>()
  const tokenWeight: number[] = []
  const tokenFor = (hex: string): number => {
    let i = tokenIndex.get(hex)
    if (i === undefined) {
      i = tokenColors.length
      tokenIndex.set(hex, i)
      tokenColors.push(hex)
      tokenWeight.push(0)
    }
    tokenWeight[i]++
    return i
  }

  let backgroundToken: number | null = null
  let sawDrawable = false

  const visit = (el: Element, inDefs: boolean) => {
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return // structural colors: leave untouched
    const nowInDefs = inDefs || tag === 'defs'

    // Element-level color attributes.
    for (const attr of COLOR_ATTRS) {
      const v = el.getAttribute(attr)
      if (v == null) continue
      const hex = normalizeHex(v)
      if (!hex) continue // `none`, `url(#...)`, `currentColor`, …
      el.setAttribute(attr, `%%c${tokenFor(hex)}%%`)
    }

    const style = el.getAttribute('style')
    if (style && readStyleColors(style).length > 0) {
      el.setAttribute(
        'style',
        writeStyleColors(style, (prop, value) => {
          if (!(COLOR_ATTRS as readonly string[]).includes(prop)) return null
          const hex = normalizeHex(value)
          return hex ? `%%c${tokenFor(hex)}%%` : null
        }),
      )
    }

    // Background plate: the first painted, full-bleed shape in document order.
    if (!nowInDefs && !sawDrawable && DRAWABLE_TAGS.has(tag)) {
      const fill = el.getAttribute('fill') ?? ''
      if (fill.startsWith('%%c')) {
        const full =
          tag === 'rect'
            ? rectIsFullBleed(el, box)
            : tag === 'path'
              ? pathIsFullBleed(el.getAttribute('d') ?? '', box)
              : false
        if (full) backgroundToken = parseInt(fill.slice(3), 10)
      }
      sawDrawable = true
    }

    for (const child of Array.from(el.children)) visit(child, nowInDefs)
  }

  for (const child of Array.from(root.children)) visit(child, false)

  // Root-level `fill` (Figma writes fill="none") is dropped with the root tag.
  const serializer = new XMLSerializer()
  let template = Array.from(root.childNodes)
    .map((n) => serializer.serializeToString(n))
    .join('')
  // The host <svg> already declares the SVG namespace; per-child re-declarations
  // that the serializer adds are just noise in the exported file.
  template = template.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
  template = namespaceIds(template, `p${id.replace(/[^a-z0-9]/g, '')}`)

  // ---- group the colors ----
  const clusters = clusterColors(tokenColors, tokenWeight)
  const tokenL = tokenColors.map((c) => hexToLab(c).L)

  const ordered = clusters
    .map((c) => {
      const isBackground = backgroundToken !== null && c.members.includes(backgroundToken)
      const meanL = c.members.reduce((s, m) => s + tokenL[m], 0) / c.members.length
      // Chip: the heaviest member reads as the group's identity.
      const sample = c.members.slice().sort((a, b) => tokenWeight[b] - tokenWeight[a])[0]
      return { ...c, isBackground, meanL, sample: tokenColors[sample] }
    })
    .sort((a, b) => {
      if (a.isBackground !== b.isBackground) return a.isBackground ? -1 : 1
      return b.weight - a.weight
    })

  let inkN = 0
  const groups: ColorGroup[] = ordered.map((c, index) => ({
    index,
    label: c.isBackground ? 'Plate' : `Ink ${++inkN}`,
    sample: c.sample,
    isBackground: c.isBackground,
    tokens: c.members.slice().sort((a, b) => a - b),
    meanL: c.meanL,
    weight: c.weight,
  }))

  const tokenGroup = new Array<number>(tokenColors.length).fill(0)
  for (const g of groups) for (const t of g.tokens) tokenGroup[t] = g.index

  return {
    id,
    name,
    width: box.w,
    height: box.h,
    template,
    tokenColors,
    tokenL,
    groups,
    tokenGroup,
  }
}
