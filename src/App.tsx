import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DOC_VERSION, type Palette, type OrbDoc, type Preset } from './types'
import { OrbSvg } from './render/OrbSvg'
import { Header } from './ui/Header'
import { Sidebar } from './ui/Sidebar'
import { Stage } from './ui/Stage'
import { useDoc } from './state/useDoc'
import { BUILTIN_PALETTES, newPaletteId, paletteById } from './lib/palettes'
import {
  applyOrbType,
  DEFAULT_PATTERN_IDS,
  defaultDoc,
  defaultPatternColors,
  makePatternLayer,
} from './lib/defaults'
import { ORB_TYPE_LABELS, type LockSection, type OrbType } from './types'
import { randomSeed } from './lib/rng'
import { pickPalette, remix, remixSection, shuffleColors } from './lib/remix'
import {
  getParsed,
  importPatternSvg,
  listImported,
  listPatternOptions,
  loadPattern,
  loadPatterns,
  PATTERN_SOURCES,
  rehydrateImported,
} from './lib/patterns/registry'
import type { ParsedPattern } from './lib/patterns/parse'
import {
  downloadBlob,
  downloadText,
  orbFilename,
  rasterizeSvg,
  serializeSvg,
} from './lib/export'
import * as storage from './lib/storage'
import { BatchPanel, type BatchCell } from './ui/BatchPanel'
import { blobEntry, createZip, textEntry, type ZipEntry } from './lib/zip'

const SECTION_KEYS = ['orb', 'palette', 'accents', 'canvas', 'export'] as const

const DEFAULT_OPEN: Record<string, boolean> = {
  orb: true,
  palette: true,
  accents: false,
  canvas: false,
  export: false,
}

export default function App() {
  /* ---- boot: parse the patterns the initial document needs ---- */
  const [booted, setBooted] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [parsedById, setParsedById] = useState<Map<string, ParsedPattern>>(new Map())

  const [initial] = useState<OrbDoc>(() => storage.loadDoc() ?? defaultDoc(randomSeed()))
  const { doc, update: rawUpdate, replace, undo, redo, canUndo, canRedo } = useDoc(initial)

  const [palettes, setPalettes] = useState<Palette[]>(() => [
    ...BUILTIN_PALETTES,
    ...storage.loadPalettes(),
  ])
  const [presets, setPresets] = useState<Preset[]>(() => storage.loadPresets())
  const palette = useMemo(() => paletteById(palettes, doc.paletteId), [palettes, doc.paletteId])

  const [ui, setUi] = useState(() => {
    const saved = storage.loadUi()
    return {
      zoom: saved?.zoom ?? 1,
      fitToStage: saved?.fitToStage ?? true,
      openSections: saved?.openSections ?? null,
      selectedLayerId: saved?.selectedLayerId ?? null,
    }
  })
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const saved = storage.loadUi()?.openSections
    if (!saved) return DEFAULT_OPEN
    const next: Record<string, boolean> = {}
    for (const k of SECTION_KEYS) next[k] = saved.includes(k)
    return next
  })

  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Lifted out of ExportPanel so the E shortcut and the batch export honour it.
  const [transparent, setTransparent] = useState(false)
  // Design-tool importers ignore <pattern> fills, so expanding is the default.
  const [expandPatterns, setExpandPatterns] = useState(true)
  // Bumped whenever the pattern library changes, to re-read the option list.
  const [patternRev, setPatternRev] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => setToast(null), error ? 5200 : 2400)
  }, [])

  const update = useCallback(
    (recipe: (d: OrbDoc) => OrbDoc, coalesce?: string) => rawUpdate(recipe, { coalesce }),
    [rawUpdate],
  )

  /* ---- pattern loading ---- */

  const ingest = useCallback((list: ParsedPattern[]) => {
    if (list.length === 0) return
    setParsedById((prev) => {
      const next = new Map(prev)
      for (const p of list) next.set(p.id, p)
      return next
    })
  }, [])

  // Boot: everything the first document references, plus the defaults so Remix
  // has something to choose from immediately.
  useEffect(() => {
    let cancelled = false
    // Imported patterns come back before anything asks for them, so a document
    // that references one still renders after a reload.
    const restored = rehydrateImported(storage.loadImportedPatterns())
    if (restored.length > 0) {
      ingest(restored)
      setPatternRev((r) => r + 1)
    }
    const needed = new Set<string>(DEFAULT_PATTERN_IDS)
    for (const layer of initial.layers) {
      if (layer.kind === 'pattern') needed.add(layer.patternId)
    }
    loadPatterns([...needed].filter((id) => PATTERN_SOURCES.some((s) => s.id === id)))
      .then((list) => {
        if (cancelled) return
        ingest(list)
        setBooted(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setBootError(err instanceof Error ? err.message : String(err))
        setBooted(true)
      })
    return () => {
      cancelled = true
    }
  }, [initial, ingest])

  // Warm the rest in the background so Remix can reach the whole library.
  useEffect(() => {
    if (!booted) return
    let cancelled = false
    const rest = PATTERN_SOURCES.filter((s) => !getParsed(s.id))
    if (rest.length === 0) return
    void (async () => {
      for (const src of rest) {
        if (cancelled) return
        try {
          const parsed = await loadPattern(src.id)
          if (!cancelled) ingest([parsed])
        } catch {
          // A single bad file must not stall the library.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [booted, ingest])

  // Any pattern a layer or a sector texture cell references but that is not
  // parsed yet — a persisted document must repaint its texture cells on load.
  useEffect(() => {
    const missing = [
      ...doc.layers
        .filter((l) => l.kind === 'pattern')
        .map((l) => (l.kind === 'pattern' ? l.patternId : '')),
      ...[...doc.orb.sectors.rowA, ...doc.orb.sectors.rowB]
        .filter((f) => f.kind === 'texture')
        .map((f) => (f.kind === 'texture' ? f.patternId : '')),
    ].filter((id) => id && !parsedById.has(id))
    if (missing.length === 0) return
    loadPatterns(missing).then(ingest).catch(() => undefined)
  }, [doc.layers, doc.orb.sectors, parsedById, ingest])

  /* ---- persistence of UI prefs ---- */
  const pendingUi = useRef<storage.UiState | null>(null)
  useEffect(() => {
    const snapshot: storage.UiState = {
      zoom: ui.zoom,
      fitToStage: ui.fitToStage,
      openSections: SECTION_KEYS.filter((k) => open[k]),
      selectedLayerId: ui.selectedLayerId,
    }
    pendingUi.current = snapshot
    const t = setTimeout(() => storage.saveUi(snapshot), 300)
    return () => clearTimeout(t)
  }, [ui, open])

  // Same flush-on-exit as the document; see the note in useDoc.
  useEffect(() => {
    const flush = () => {
      if (pendingUi.current) storage.saveUi(pendingUi.current)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => storage.savePalettes(palettes), [palettes])
  useEffect(() => storage.savePresets(presets), [presets])

  /* ---- remix ---- */

  const available = useMemo(() => [...parsedById.values()], [parsedById])
  const patternOptions = useMemo(
    () => listPatternOptions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patternRev],
  )

  const doRemix = useCallback(
    (seed?: string) => {
      const next = seed ?? randomSeed()
      replace(remix(doc, next, { available, palette }))
    },
    [doc, available, palette, replace],
  )

  /**
   * Remix All also re-rolls the palette, so the seed has to drive that choice
   * too — otherwise typing the seed back would not reproduce the output. The
   * `colors` lock still wins, and so does the narrower `colors.palette`
   * sub-lock — "I've settled on the palette, keep exploring inks". Both are
   * safe to skip around: `pickPalette` draws from its own seeded stream, so
   * skipping it cannot shift the main remix stream.
   */
  const doRemixAll = useCallback(
    (seed?: string) => {
      const next = seed ?? randomSeed()
      const nextPalette =
        doc.locks.colors || doc.subLocks.colors.palette
          ? palette
          : pickPalette(palettes, next, doc.paletteId)
      replace(
        remix({ ...doc, paletteId: nextPalette.id }, next, {
          available,
          palette: nextPalette,
        }),
      )
      if (nextPalette.id !== doc.paletteId) notify(`Palette: ${nextPalette.name}`)
    },
    [doc, palettes, palette, available, replace, notify],
  )

  const onRandomizeSection = useCallback(
    (section: Exclude<LockSection, 'colors'>) => {
      replace(remixSection(doc, section, randomSeed(), { available, palette }))
    },
    [doc, available, palette, replace],
  )

  const onRandomizePalette = useCallback(() => {
    // Both the full colors lock and the keep-palette sub-lock pin the palette
    // choice — a lock is absolute, the dice included.
    if (doc.locks.colors) return notify('Colors are locked', true)
    if (doc.subLocks.colors.palette) return notify('Palette is kept — uncheck “Keep palette” to switch', true)
    const next = pickPalette(palettes, randomSeed(), doc.paletteId)
    rawUpdate((d) => ({ ...d, paletteId: next.id }))
    notify(`Palette: ${next.name}`)
  }, [doc.locks.colors, doc.subLocks.colors.palette, palettes, doc.paletteId, rawUpdate, notify])

  const doShuffleColors = useCallback(() => {
    if (doc.locks.colors) return notify('Colors are locked', true)
    replace(shuffleColors(doc, palette, `${doc.seed}-${Date.now().toString(36)}`))
    notify('Colors re-dealt')
  }, [doc, palette, replace, notify])

  /* ---- layers ---- */

  const onAddPatternLayer = useCallback(
    async (patternId: string) => {
      try {
        const parsed = await loadPattern(patternId)
        ingest([parsed])
        rawUpdate((d) => ({ ...d, layers: [...d.layers, makePatternLayer(parsed, palette)] }))
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not load that pattern', true)
      }
    },
    [ingest, palette, rawUpdate, notify],
  )

  const onSetLayerPattern = useCallback(
    async (layerId: string, patternId: string) => {
      try {
        const parsed = await loadPattern(patternId)
        ingest([parsed])
        rawUpdate((d) => ({
          ...d,
          layers: d.layers.map((l) => {
            if (l.id !== layerId || l.kind !== 'pattern') return l
            return {
              ...l,
              patternId,
              name: parsed.name,
              // Group counts differ between patterns, so re-derive the mapping.
              colors: defaultPatternColors(parsed, palette, l.blend),
            }
          }),
        }))
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not load that pattern', true)
      }
    },
    [ingest, palette, rawUpdate, notify],
  )

  const onSetSectorTexture = useCallback(
    async (row: 'rowA' | 'rowB', index: number, patternId: string) => {
      try {
        const parsed = await loadPattern(patternId)
        ingest([parsed])
        rawUpdate((d) => ({
          ...d,
          orb: {
            ...d.orb,
            sectors: {
              ...d.orb.sectors,
              [row]: d.orb.sectors[row].map((f, i) => {
                if (i !== index) return f
                return {
                  kind: 'texture' as const,
                  patternId,
                  // Group counts differ between patterns, so re-derive — same
                  // rule as onSetLayerPattern.
                  colors: defaultPatternColors(parsed, palette, 'normal'),
                  scale: f.kind === 'texture' ? f.scale : 1,
                  rotation: f.kind === 'texture' ? f.rotation : 0,
                }
              }),
            },
          },
        }))
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not load that texture', true)
      }
    },
    [ingest, palette, rawUpdate, notify],
  )

  const onSetOrbType = useCallback(
    (type: OrbType) => {
      // One update() call, so the whole switch stays a single undo entry. The
      // skipped list is read off the same computation the updater applies.
      let skipped: ('orb' | 'patterns')[] = []
      rawUpdate((d) => {
        const result = applyOrbType(d, type)
        skipped = result.skipped
        return result.doc
      })
      const label = ORB_TYPE_LABELS[type]
      notify(
        skipped.length > 0
          ? `Orb type: ${label} (${skipped.join(', ')} locked — left as is)`
          : `Orb type: ${label}`,
      )
    },
    [rawUpdate, notify],
  )

  /* ---- palettes ---- */

  const setActivePalette = useCallback(
    (id: string) => rawUpdate((d) => ({ ...d, paletteId: id })),
    [rawUpdate],
  )

  const createPalette = useCallback(
    (name: string, colors: string[]) => {
      const p: Palette = { id: newPaletteId(name), name, colors }
      setPalettes((prev) => [...prev, p])
      setActivePalette(p.id)
      notify(`Palette “${name}” created`)
    },
    [setActivePalette, notify],
  )

  const updatePalette = useCallback((id: string, patch: Partial<Palette>) => {
    setPalettes((prev) => prev.map((p) => (p.id === id && !p.builtin ? { ...p, ...patch } : p)))
  }, [])

  const duplicatePalette = useCallback(
    (id: string) => {
      setPalettes((prev) => {
        const src = prev.find((p) => p.id === id)
        if (!src) return prev
        const name = `${src.name} copy`
        const copy: Palette = { id: newPaletteId(name), name, colors: [...src.colors] }
        queueMicrotask(() => setActivePalette(copy.id))
        return [...prev, copy]
      })
    },
    [setActivePalette],
  )

  const deletePalette = useCallback(
    (id: string) => {
      setPalettes((prev) => {
        const next = prev.filter((p) => p.id !== id)
        if (doc.paletteId === id) {
          queueMicrotask(() => setActivePalette(next[0]?.id ?? BUILTIN_PALETTES[0].id))
        }
        return next
      })
    },
    [doc.paletteId, setActivePalette],
  )

  const exportPalettes = useCallback(() => {
    const custom = palettes.filter((p) => !p.builtin)
    const payload = {
      format: 'orbgen.palettes',
      version: 1,
      palettes: custom.length > 0 ? custom : [{ ...palette, builtin: undefined }],
    }
    downloadText(JSON.stringify(payload, null, 2), 'orb-palettes.json', 'application/json')
  }, [palettes, palette])

  const importPalettes = useCallback(
    (json: string) => {
      try {
        const data: unknown = JSON.parse(json)
        const raw: unknown[] = Array.isArray(data)
          ? data
          : typeof data === 'object' && data !== null && Array.isArray((data as { palettes?: unknown[] }).palettes)
            ? ((data as { palettes: unknown[] }).palettes)
            : [data]

        const incoming: Palette[] = []
        for (const item of raw) {
          if (typeof item !== 'object' || item === null) continue
          const o = item as { name?: unknown; colors?: unknown; id?: unknown }
          if (!Array.isArray(o.colors) || o.colors.length === 0) continue
          const colors = o.colors.filter((c): c is string => typeof c === 'string')
          if (colors.length === 0) continue
          const name = typeof o.name === 'string' && o.name ? o.name : 'Imported palette'
          incoming.push({ id: newPaletteId(name), name, colors })
        }
        if (incoming.length === 0) {
          notify('No palettes found in that file', true)
          return
        }
        setPalettes((prev) => [...prev, ...incoming])
        setActivePalette(incoming[0].id)
        notify(`Imported ${incoming.length} palette${incoming.length === 1 ? '' : 's'}`)
      } catch {
        notify('That file is not valid JSON', true)
      }
    },
    [setActivePalette, notify],
  )

  /* ---- presets ---- */

  const savePreset = useCallback(
    (name: string) => {
      const preset: Preset = {
        id: `${newPaletteId(name)}`,
        name,
        savedAt: Date.now(),
        doc: { ...doc, version: DOC_VERSION },
      }
      setPresets((prev) => [...prev, preset])
      notify(`Preset “${name}” saved`)
    },
    [doc, notify],
  )

  const loadPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id)
      if (!preset) return
      replace(preset.doc)
      notify(`Loaded “${preset.name}”`)
    },
    [presets, replace, notify],
  )

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const serializeOpts = useCallback(
    (asTransparent: boolean) => ({
      transparent: asTransparent,
      expandPatterns,
      onNote: notify,
    }),
    [expandPatterns, notify],
  )

  /* ---- pattern import ---- */

  const importSvgFiles = useCallback(
    async (files: File[]) => {
      const svgs = files.filter(
        (f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name),
      )
      if (svgs.length === 0) {
        return notify('Drop .svg files to add patterns', true)
      }
      const added: ParsedPattern[] = []
      const failed: string[] = []
      for (const file of svgs) {
        try {
          added.push(importPatternSvg(file.name, await file.text()))
        } catch {
          failed.push(file.name)
        }
      }
      if (added.length > 0) {
        ingest(added)
        setPatternRev((r) => r + 1)
        const dropped = storage.saveImportedPatterns(listImported())
        const names = added.map((p) => p.name).join(', ')
        if (dropped.length > 0) {
          notify(
            `Imported ${names} — too large to persist, so it will be gone after a reload`,
            true,
          )
        } else {
          notify(`Imported ${names}`)
        }
      }
      if (failed.length > 0) notify(`Could not parse: ${failed.join(', ')}`, true)
    },
    [ingest, notify],
  )

  /* ---- export ---- */

  const exportSvg = useCallback(
    (asTransparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      downloadText(serializeSvg(el, serializeOpts(asTransparent)), orbFilename(doc.seed, 'svg'))
      notify('SVG exported')
    },
    [doc.seed, notify, serializeOpts],
  )

  const copySvg = useCallback(
    async (asTransparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      try {
        await navigator.clipboard.writeText(serializeSvg(el, serializeOpts(asTransparent)))
        notify('SVG markup copied')
      } catch {
        notify('Clipboard access was blocked', true)
      }
    },
    [notify, serializeOpts],
  )

  /**
   * The paste-into-Figma path: Figma parses SVG markup straight off the
   * clipboard into editable layers. Always expands pattern tiles regardless of
   * the export checkbox — Figma drops `<pattern>` fills, so an unexpanded copy
   * would silently lose its texture — and rides on the same serialization the
   * downloads use (named layers included), so what pastes is what previews.
   */
  const copyForFigma = useCallback(
    async (asTransparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      try {
        await navigator.clipboard.writeText(
          serializeSvg(el, { transparent: asTransparent, expandPatterns: true, onNote: notify }),
        )
        notify('Copied — paste into Figma with ⌘V')
      } catch {
        notify('Clipboard access was blocked', true)
      }
    },
    [notify],
  )

  const exportPng = useCallback(
    async (longEdge: number, transparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      setBusy(true)
      try {
        const text = serializeSvg(el, { transparent, expandPatterns: false })
        const blob = await rasterizeSvg(
          text,
          doc.canvas.width,
          doc.canvas.height,
          longEdge,
          transparent,
        )
        downloadBlob(blob, orbFilename(doc.seed, 'png', `${longEdge}`))
        notify(`PNG exported at ${longEdge}px long edge`)
      } catch (err) {
        notify(err instanceof Error ? err.message : 'PNG export failed', true)
      } finally {
        setBusy(false)
      }
    },
    [doc.canvas.height, doc.canvas.width, doc.seed, notify],
  )

  /* ---- batch ---- */

  const [batchFormat, setBatchFormat] = useState<'svg' | 'png' | 'both'>('svg')
  const [batchPngSize, setBatchPngSize] = useState(1024)

  /**
   * Zip every cell up. The SVG text comes from each cell's live node, the same
   * path the single-file export uses, so a batch file and a promoted-then-exported
   * file are identical.
   */
  const exportBatch = useCallback(
    async (cells: BatchCell[], nodes: Map<string, SVGSVGElement>) => {
      setBusy(true)
      try {
        const entries: ZipEntry[] = []
        const missing: string[] = []
        for (const cell of cells) {
          const el = nodes.get(cell.seed)
          if (!el) {
            missing.push(cell.seed)
            continue
          }
          if (batchFormat === 'svg' || batchFormat === 'both') {
            entries.push(
              textEntry(
                orbFilename(cell.seed, 'svg'),
                serializeSvg(el, { transparent, expandPatterns }),
              ),
            )
          }
          if (batchFormat === 'png' || batchFormat === 'both') {
            const png = await rasterizeSvg(
              serializeSvg(el, { transparent, expandPatterns: false }),
              cell.doc.canvas.width,
              cell.doc.canvas.height,
              batchPngSize,
              transparent,
            )
            // Same long-edge suffix the single-file PNG export uses.
            entries.push(
              await blobEntry(orbFilename(cell.seed, 'png', `${batchPngSize}`), png),
            )
          }
        }
        if (entries.length === 0) throw new Error('Nothing to export')
        const zip = createZip(entries)
        downloadBlob(zip, `orb-batch-${cells[0]?.seed.split('-').slice(0, 2).join('-') ?? 'set'}.zip`)
        notify(
          `Zipped ${entries.length} file${entries.length === 1 ? '' : 's'}` +
            (missing.length > 0 ? ` — ${missing.length} cell(s) were not rendered` : ''),
          missing.length > 0,
        )
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Batch export failed', true)
      } finally {
        setBusy(false)
      }
    },
    [batchFormat, batchPngSize, transparent, expandPatterns, notify],
  )

  /**
   * The whole collection as one clipboard paste: each cell's live node is
   * serialized exactly like its single-file export (tiles expanded — Figma
   * drops `<pattern>` fills) and nested as an `<svg x y>` in a near-square
   * grid. Nested svgs keep their own defs, and per-cell id prefixes already
   * make those collision-free; Figma flattens each into its own named group.
   */
  const copyBatchForFigma = useCallback(
    async (cells: BatchCell[], nodes: Map<string, SVGSVGElement>) => {
      const present = cells.filter((c) => nodes.get(c.seed))
      if (present.length === 0) return notify('No rendered cells to copy', true)
      const w = doc.canvas.width
      const h = doc.canvas.height
      const gutter = Math.round(Math.max(w, h) * 0.08)
      const cols = Math.ceil(Math.sqrt(present.length))
      const rows = Math.ceil(present.length / cols)
      const chunks = present.map((cell, i) => {
        const el = nodes.get(cell.seed)!
        const x = (i % cols) * (w + gutter)
        const y = Math.floor(i / cols) * (h + gutter)
        const inner = serializeSvg(el, { transparent, expandPatterns: true })
          .replace(/^<\?xml[^>]*\?>\s*/, '')
        // Name the nested svg after its seed so Figma's group carries it.
        return inner.replace('<svg ', `<svg x="${x}" y="${y}" id="orb-${cell.seed}" `)
      })
      const totalW = cols * w + (cols - 1) * gutter
      const totalH = rows * h + (rows - 1) * gutter
      const svg =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" ` +
        `viewBox="0 0 ${totalW} ${totalH}">\n${chunks.join('\n')}\n</svg>`
      try {
        await navigator.clipboard.writeText(svg)
        notify(`Copied ${present.length} orbs — paste into Figma with ⌘V`)
      } catch {
        notify('Clipboard access was blocked', true)
      }
    },
    [doc.canvas.width, doc.canvas.height, transparent, notify],
  )

  /** One batch cell for Figma, without promoting it — same path as the
   *  single-orb Copy for Figma, fed by the cell's live node. */
  const copyBatchCellForFigma = useCallback(
    async (cell: BatchCell, el: SVGSVGElement) => {
      try {
        await navigator.clipboard.writeText(
          serializeSvg(el, { transparent, expandPatterns: true, onNote: notify }),
        )
        notify(`Copied ${cell.seed} — paste into Figma with ⌘V`)
      } catch {
        notify('Clipboard access was blocked', true)
      }
    },
    [transparent, notify],
  )

  const promoteBatchCell = useCallback(
    (next: OrbDoc) => {
      replace(next)
      setBatchOpen(false)
      notify(`Promoted ${next.seed}`)
    },
    [replace, notify],
  )

  /* ---- keyboard shortcuts ---- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod) return
      const key = e.key.toLowerCase()
      if (key === 'r') {
        e.preventDefault()
        if (e.shiftKey) doRemixAll()
        else doRemix()
      } else if (key === 's') {
        e.preventDefault()
        doShuffleColors()
      } else if (key === 'e') {
        e.preventDefault()
        exportSvg(transparent)
      } else if (key === 'b') {
        e.preventDefault()
        setBatchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doRemix, doRemixAll, doShuffleColors, exportSvg, transparent, undo, redo])

  /* ---- drag and drop pattern import ---- */

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // Without this the browser navigates to the dropped file instead.
      e.preventDefault()
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void importSvgFiles(Array.from(e.dataTransfer?.files ?? []))
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importSvgFiles])

  if (!booted) {
    return <div className="boot">Parsing pattern library…</div>
  }

  return (
    <div className="app">
      <Header
        seed={doc.seed}
        canUndo={canUndo}
        canRedo={canRedo}
        presets={presets}
        colorsLocked={doc.locks.colors}
        onRemix={() => doRemix()}
        onRemixAll={() => doRemixAll()}
        onShuffleColors={doShuffleColors}
        onSeedChange={(seed) => doRemixAll(seed)}
        onUndo={undo}
        onRedo={redo}
        onSavePreset={savePreset}
        onLoadPreset={loadPreset}
        onDeletePreset={deletePreset}
        batchOpen={batchOpen}
        onToggleBatch={() => setBatchOpen((v) => !v)}
      />

      <Stage
        width={doc.canvas.width}
        height={doc.canvas.height}
        zoom={ui.zoom}
        fit={ui.fitToStage}
        onZoomChange={(zoom) => setUi((u) => ({ ...u, zoom }))}
        onFitChange={(fitToStage) => setUi((u) => ({ ...u, fitToStage }))}
      >
        <OrbSvg
          doc={doc}
          palette={palette}
          parsedById={parsedById}
          svgRef={svgRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </Stage>

      <Sidebar
        doc={doc}
        palette={palette}
        parsedById={parsedById}
        presets={presets}
        open={open}
        onToggleSection={(key) => setOpen((o) => ({ ...o, [key]: !o[key] }))}
        selectedLayerId={ui.selectedLayerId}
        onSelectLayer={(selectedLayerId) => setUi((u) => ({ ...u, selectedLayerId }))}
        update={update}
        onAddPatternLayer={onAddPatternLayer}
        onSetLayerPattern={onSetLayerPattern}
        onSetSectorTexture={onSetSectorTexture}
        onSetOrbType={onSetOrbType}
        onRandomizeSection={onRandomizeSection}
        onRandomizePalette={onRandomizePalette}
        patternOptions={patternOptions}
        palettePanel={{
          palettes,
          onSetActive: setActivePalette,
          onCreate: createPalette,
          onUpdate: updatePalette,
          onDelete: deletePalette,
          onDuplicate: duplicatePalette,
          onImport: importPalettes,
          onExport: exportPalettes,
        }}
        exportPanel={{
          seed: doc.seed,
          canvas: doc.canvas,
          busy,
          transparent,
          onTransparentChange: setTransparent,
          backgroundIsNone: doc.background.kind === 'transparent',
          expandPatterns,
          onExpandPatternsChange: setExpandPatterns,
          onExportSvg: exportSvg,
          onExportPng: exportPng,
          onCopySvg: copySvg,
          onCopyFigma: copyForFigma,
        }}
      />

      {batchOpen && (
        <BatchPanel
          doc={doc}
          palettes={palettes}
          parsedById={parsedById}
          available={available}
          transparent={transparent}
          busy={busy}
          format={batchFormat}
          pngSize={batchPngSize}
          onFormatChange={setBatchFormat}
          onPngSizeChange={setBatchPngSize}
          onClose={() => setBatchOpen(false)}
          onPromote={promoteBatchCell}
          onExportAll={exportBatch}
          onCopyFigma={copyBatchForFigma}
          onCopyCellFigma={copyBatchCellForFigma}
        />
      )}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone__inner">
            <div className="dropzone__title">Drop SVGs to add patterns</div>
            <div className="note">
              Each file goes through the same fill extraction and palette-slot mapping as the
              built-in library.
            </div>
          </div>
        </div>
      )}

      {bootError && <div className="toast toast--error">Pattern library: {bootError}</div>}
      {toast && <div className={`toast${toast.error ? ' toast--error' : ''}`}>{toast.text}</div>}
    </div>
  )
}
