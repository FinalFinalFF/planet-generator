/**
 * Headless generation API — the page `tools/orbgen` drives in headless Chrome.
 *
 * Exposes `window.orbgen` on `api.html`. It renders with the same `OrbSvg` and
 * exports through the same `serializeSvg` / `rasterizeSvg` the editor uses, so
 * an orb generated here is byte-identical to the same document exported from
 * the app — the one-SVG invariant extends to automation instead of forking it.
 * Pattern parsing needs `DOMParser` and tile expansion needs `getBBox`, which
 * is why this runs in a real browser rather than Node.
 *
 * Seeds follow Batch: orb i of a run is `${seed}-${i + 1}`, so a run is
 * reproducible from its seed and options.
 */

import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { OrbSvg } from './render/OrbSvg'
import { rasterizeSvg, serializeSvg } from './lib/export'
import { PATTERN_SOURCES, loadPatterns } from './lib/patterns/registry'
import type { ParsedPattern } from './lib/patterns/parse'
import { BUILTIN_PALETTES, paletteById } from './lib/palettes'
import { BUILTIN_PRESETS, defaultPresetDoc } from './lib/presets'
import { applyOrbType, defaultDoc, normalizeDoc } from './lib/defaults'
import { pickPalette, remix } from './lib/remix'
import {
  PhotosContext,
  decodePhoto,
  loadCatalog,
  loadLibraryPhoto,
  LIBRARY_PREFIX,
  type Photo,
  type PhotoMeta,
} from './lib/photos'
import { makeRng } from './lib/rng'
import { EMPTY_PREFS, framingFor, loadPhotoPrefs, type PhotoPrefs } from './lib/photoPrefs'
import { ORB_TYPES, type Locks, type OrbDoc, type OrbType, type PoolPhoto } from './types'

export type GenerateRequest = {
  /** How many orbs (1–50). Default 1. */
  count?: number
  /** Run seed; orb i uses `${seed}-${i + 1}`. Default: random. */
  seed?: string
  /**
   * Starting document: a preset id or name ('default' = the shipped default
   * preset, 'blank' = a fresh default document), or a whole OrbDoc (a preset
   * export's `doc`). Default 'default'.
   */
  base?: string | OrbDoc
  /** 'remix' (default) deals each orb from the base; 'none' renders the base as-is. */
  mode?: 'remix' | 'none'
  /** Palette id or name for every orb. Default: the base document's palette. */
  palette?: string
  /** Each orb picks its own palette from its seed, like Batch's "Vary palette". */
  varyPalette?: boolean
  /** Pin the orb type (sets the type sub-lock so remix keeps it). */
  orbType?: OrbType
  colorSource?: 'palette' | 'gradients'
  flat?: boolean
  solidFills?: boolean
  /** Section locks to set on the base before remixing. */
  locks?: Partial<Locks>
  /**
   * The photo pool (`doc.photoPool`): each orb gets a count in `photosPerOrb`
   * of different pool photos in different segments, each with its own
   * framing. A photo is uploaded bytes (`dataUrl`) or a library photo (`id`,
   * from `options().library` — its face-detected focal point is the default
   * framing). Remix steers to segments while the pool is live.
   */
  photos?: PhotoSpec[]
  /** Shorthand for a one-photo pool — kept from the single-photo API. */
  photo?: PhotoSpec
  /** Fill the pool from the local photo library (adds to `photos`). */
  library?: {
    /** Folder tags to draw from (any match), e.g. "Tuesday Selects". */
    tags?: string[]
    /** Substring of a photo name or folder tag. */
    search?: string
    /** Only photos from curated "selects"/"edits" folders. Default true. */
    selectsOnly?: boolean
    /** Only the photo library's favorites (app-level, set in the editor). */
    favoritesOnly?: boolean
    /** How many to put in the pool (picked from the run seed). Default 12. */
    count?: number
  }
  /** Photos per orb, inclusive. Default { min: 1, max: 1 }. */
  photosPerOrb?: { min?: number; max?: number }
  /** Restrict the patterns remix may deal (ids or names). */
  patterns?: { include?: string[]; exclude?: string[] }
  canvas?: { width: number; height: number }
  /** Drop the background, as the editor's transparent export does. */
  transparent?: boolean
  /** Default 'svg'. */
  format?: 'svg' | 'png' | 'both'
  /** PNG long edge in pixels. Default 2048. */
  pngSize?: number
  /** Include each orb's document (to reload it in the editor or re-render). */
  includeDoc?: boolean
}

export type PhotoSpec = {
  /** A library photo id (`lib:…`). */
  id?: string
  /** Or the image itself, as any image data URL. */
  dataUrl?: string
  name?: string
  zoom?: number
  focusX?: number
  focusY?: number
}

export type GeneratedOrb = {
  name: string
  seed: string
  paletteId: string
  paletteName: string
  orbType: OrbType
  width: number
  height: number
  svg?: string
  /** Base64 PNG, no data: prefix. */
  png?: string
  doc?: OrbDoc
}

export type GenerateResult = { seed: string; orbs: GeneratedOrb[]; notes: string[] }

const byIdOrName = <T extends { id: string; name: string }>(list: T[], key: string) => {
  const k = key.trim().toLowerCase()
  return list.find((x) => x.id.toLowerCase() === k) ?? list.find((x) => x.name.toLowerCase() === k)
}

const randomSeed = () => `api-${Math.random().toString(36).slice(2, 8)}`

let parsedPromise: Promise<Map<string, ParsedPattern>> | null = null
function allPatterns(): Promise<Map<string, ParsedPattern>> {
  parsedPromise ??= loadPatterns(PATTERN_SOURCES.map((s) => s.id)).then(
    (list) => new Map(list.map((p) => [p.id, p])),
  )
  return parsedPromise
}

function resolveBase(base: GenerateRequest['base']): OrbDoc {
  if (base && typeof base === 'object') return normalizeDoc(structuredClone(base))
  const key = (base ?? 'default').trim()
  if (key === 'default') return defaultPresetDoc() ?? defaultDoc(randomSeed())
  if (key === 'blank') return defaultDoc(randomSeed())
  const preset = byIdOrName(BUILTIN_PRESETS, key)
  if (!preset) {
    throw new Error(
      `Unknown base "${key}". Use 'default', 'blank', a preset (${BUILTIN_PRESETS.map((p) => p.name).join(', ')}) or a document.`,
    )
  }
  return normalizeDoc(structuredClone(preset.doc))
}

/** Render one document offscreen and export it exactly as the editor would. */
async function renderOne(
  doc: OrbDoc,
  parsedById: Map<string, ParsedPattern>,
  photos: Map<string, Photo>,
  idPrefix: string,
  req: GenerateRequest,
  notes: string[],
): Promise<Pick<GeneratedOrb, 'svg' | 'png'>> {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:400px;height:400px'
  document.body.appendChild(host)
  const root = createRoot(host)
  let el: SVGSVGElement | null = null
  try {
    flushSync(() =>
      root.render(
        <PhotosContext.Provider value={photos}>
          <OrbSvg
            doc={doc}
            palette={paletteById(BUILTIN_PALETTES, doc.paletteId)}
            parsedById={parsedById}
            idPrefix={idPrefix}
            svgRef={(node) => (el = node)}
            style={{ width: 400, height: 400, display: 'block' }}
          />
        </PhotosContext.Provider>,
      ),
    )
    const node = el as SVGSVGElement | null
    if (!node) throw new Error('Render produced no <svg>')
    const transparent = !!req.transparent
    const format = req.format ?? 'svg'
    const out: Pick<GeneratedOrb, 'svg' | 'png'> = {}
    if (format !== 'png') {
      // Same options as the editor's SVG / Figma export.
      out.svg = serializeSvg(node, {
        transparent,
        expandPatterns: true,
        onNote: (m, warn) => warn && notes.push(`${idPrefix}: ${m}`),
      })
    }
    if (format !== 'svg') {
      const blob = await rasterizeSvg(
        serializeSvg(node, { transparent, expandPatterns: false }),
        doc.canvas.width,
        doc.canvas.height,
        Math.max(64, Math.min(8192, req.pngSize ?? 2048)),
        transparent,
      )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      out.png = btoa(bin)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}

async function generate(req: GenerateRequest = {}): Promise<GenerateResult> {
  const notes: string[] = []
  const parsedById = await allPatterns()
  const count = Math.max(1, Math.min(50, Math.floor(req.count ?? 1)))
  const seed = (req.seed ?? '').trim() || randomSeed()

  let base = resolveBase(req.base)
  if (req.palette) {
    const p = byIdOrName(BUILTIN_PALETTES, req.palette)
    if (!p) throw new Error(`Unknown palette "${req.palette}" — see options().palettes`)
    base = { ...base, paletteId: p.id }
  }
  if (req.canvas) {
    const width = Math.max(16, Math.min(8000, Math.round(req.canvas.width)))
    const height = Math.max(16, Math.min(8000, Math.round(req.canvas.height)))
    base = { ...base, canvas: { width, height } }
  }
  if (req.locks) base = { ...base, locks: { ...base.locks, ...req.locks } }
  if (req.orbType) {
    if (!ORB_TYPES.includes(req.orbType)) throw new Error(`orbType must be one of ${ORB_TYPES.join(', ')}`)
    // The request is the user's own hand: unlock, switch, then pin the type so
    // remix keeps it.
    base = applyOrbType({ ...base, locks: { ...base.locks, orb: false } }, req.orbType).doc
    base = {
      ...base,
      locks: { ...base.locks, orb: req.locks?.orb ?? false },
      subLocks: { ...base.subLocks, orb: { ...base.subLocks.orb, type: true } },
    }
  }
  if (req.colorSource) base = { ...base, colorSource: req.colorSource }
  if (req.flat !== undefined) base = { ...base, flat: req.flat }
  if (req.solidFills !== undefined) base = { ...base, solidFills: req.solidFills }

  const photos = new Map<string, Photo>()
  const specs: PhotoSpec[] = [...(req.photos ?? []), ...(req.photo ? [req.photo] : [])]
  let catalog: PhotoMeta[] | null = null
  const library = async () => (catalog ??= await loadCatalog())
  // App-level curation from the editor: hidden photos are never picked,
  // favorites can be required, and site-wide framing is the default framing.
  let prefs: PhotoPrefs | null = null
  const curation = async () => (prefs ??= catalog?.length === 0 ? EMPTY_PREFS : (await loadPhotoPrefs()).prefs)
  if (req.library) {
    const { tags, search, selectsOnly = true, favoritesOnly = false, count = 12 } = req.library
    const q = search?.trim().toLowerCase()
    const { hidden, favorites } = await curation()
    const matches = (await library()).filter(
      (m) =>
        !hidden.includes(m.id) &&
        (!favoritesOnly || favorites.includes(m.id)) &&
        (!selectsOnly || favoritesOnly || m.selects) &&
        (!tags?.length || m.tags.some((t) => tags.some((x) => t.toLowerCase() === x.toLowerCase()))) &&
        (!q || m.name.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q))),
    )
    if (matches.length === 0) notes.push('No library photos matched; the pool gets none from the library.')
    // Picked from the run seed, so the same request reproduces the same pool.
    const rng = makeRng(`${seed}-library`)
    for (let k = 0; k < Math.min(count, matches.length); k++) {
      specs.push({ id: matches.splice(rng.int(0, matches.length - 1), 1)[0].id })
    }
  }
  const pool: PoolPhoto[] = []
  const clamp01 = (v: number | undefined, d: number) => Math.max(0, Math.min(1, v ?? d))
  for (const spec of specs) {
    let photo: Photo
    let meta: PhotoMeta | undefined
    if (spec.id) {
      const id = spec.id.startsWith(LIBRARY_PREFIX) ? spec.id : `${LIBRARY_PREFIX}${spec.id}`
      meta = (await library()).find((m) => m.id === id)
      if (!meta) throw new Error(`No library photo "${spec.id}" — is the photo library built and served?`)
      photo = await loadLibraryPhoto(meta)
    } else if (spec.dataUrl) {
      const blob = await (await fetch(spec.dataUrl)).blob()
      photo = await decodePhoto(blob, spec.name ?? 'Photo')
    } else {
      throw new Error('Each photo needs an id (library) or a dataUrl')
    }
    photos.set(photo.id, photo)
    const site = meta ? framingFor(meta, await curation()) : { zoom: 1, focusX: 0.5, focusY: 0.5 }
    pool.push({
      photoId: photo.id,
      zoom: Math.max(1, Math.min(8, spec.zoom ?? site.zoom)),
      focusX: clamp01(spec.focusX, site.focusX),
      focusY: clamp01(spec.focusY, site.focusY),
    })
  }
  if (pool.length > 0 || req.photosPerOrb) {
    const min = Math.max(0, Math.min(6, Math.round(req.photosPerOrb?.min ?? 1)))
    const max = Math.max(min, Math.min(6, Math.round(req.photosPerOrb?.max ?? Math.max(1, min))))
    base = { ...base, photoPool: { photos: pool.length ? pool : base.photoPool.photos, min, max } }
    if (req.orbType && req.orbType !== 'segments') {
      notes.push(`Photos need a segments orb; orbType "${req.orbType}" is pinned, so none are placed.`)
    }
  }
  // A base document can carry its own pool (and photo cells); load any of
  // those library photos too, or they would render as empty cells.
  const wanted = new Set(base.photoPool.photos.map((p) => p.photoId))
  for (const f of [...base.orb.sectors.rowA, ...base.orb.sectors.rowB]) if (f.kind === 'photo') wanted.add(f.photoId)
  for (const id of wanted) {
    if (photos.has(id)) continue
    const meta = id.startsWith(LIBRARY_PREFIX) ? (await library()).find((m) => m.id === id) : undefined
    if (meta) photos.set(id, await loadLibraryPhoto(meta))
    else notes.push(`Photo ${id} is not available here; its cells render empty.`)
  }

  let available = [...parsedById.values()]
  const matches = (p: ParsedPattern, keys: string[]) =>
    keys.some((k) => p.id.toLowerCase() === k.toLowerCase() || p.name.toLowerCase() === k.toLowerCase())
  if (req.patterns?.include?.length) available = available.filter((p) => matches(p, req.patterns!.include!))
  if (req.patterns?.exclude?.length) available = available.filter((p) => !matches(p, req.patterns!.exclude!))
  if (available.length === 0) notes.push('No patterns matched; orbs are dealt without textures.')

  const orbs: GeneratedOrb[] = []
  for (let i = 0; i < count; i++) {
    const orbSeed = req.mode === 'none' ? base.seed : `${seed}-${i + 1}`
    let doc = base
    if (req.mode !== 'none') {
      const palette =
        req.varyPalette && !base.locks.colors
          ? pickPalette(BUILTIN_PALETTES, orbSeed, base.paletteId)
          : paletteById(BUILTIN_PALETTES, base.paletteId)
      doc = remix({ ...base, paletteId: palette.id }, orbSeed, { available, palette })
    }
    const palette = paletteById(BUILTIN_PALETTES, doc.paletteId)
    const rendered = await renderOne(doc, parsedById, photos, `o${i + 1}`, req, notes)
    orbs.push({
      name: `Orb ${orbSeed}`,
      seed: orbSeed,
      paletteId: palette.id,
      paletteName: palette.name,
      orbType: doc.orbType,
      width: doc.canvas.width,
      height: doc.canvas.height,
      ...rendered,
      ...(req.includeDoc ? { doc } : {}),
    })
    if (req.mode === 'none') break
  }
  return { seed, orbs, notes }
}

async function options() {
  const catalog = await loadCatalog()
  const tags = new Map<string, number>()
  for (const m of catalog) for (const t of m.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
  return {
    library: {
      photos: catalog.length,
      selects: catalog.filter((m) => m.selects).length,
      tags: [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    },
    palettes: BUILTIN_PALETTES.map((p) => ({ id: p.id, name: p.name, colors: p.colors })),
    presets: BUILTIN_PRESETS.map((p) => ({ id: p.id, name: p.name, default: !!p.default })),
    patterns: PATTERN_SOURCES.map((s) => ({ id: s.id, name: s.name })),
    orbTypes: [...ORB_TYPES],
  }
}

declare global {
  interface Window {
    orbgen: { ready: Promise<void>; options: typeof options; generate: typeof generate }
  }
}

window.orbgen = {
  ready: allPatterns().then(() => undefined),
  options,
  generate,
}
document.title = 'orbgen api'
