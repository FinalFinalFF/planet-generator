import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DOC_VERSION, type Palette, type PlanetDoc, type Preset } from './types'
import { PlanetSvg } from './render/PlanetSvg'
import { Header } from './ui/Header'
import { Sidebar } from './ui/Sidebar'
import { Stage } from './ui/Stage'
import { useDoc } from './state/useDoc'
import { BUILTIN_PALETTES, newPaletteId, paletteById } from './lib/palettes'
import {
  applyPlanetStyle,
  DEFAULT_PATTERN_IDS,
  defaultDoc,
  defaultPatternColors,
  makePatternLayer,
} from './lib/defaults'
import { PLANET_STYLE_LABELS, type LockSection, type PlanetStyle } from './types'
import { randomSeed } from './lib/rng'
import { pickPalette, remix, remixSection, shuffleColors } from './lib/remix'
import { getParsed, loadPattern, loadPatterns, PATTERN_SOURCES } from './lib/patterns/registry'
import type { ParsedPattern } from './lib/patterns/parse'
import {
  downloadBlob,
  downloadText,
  planetFilename,
  rasterizeSvg,
  serializeSvg,
} from './lib/export'
import * as storage from './lib/storage'

const SECTION_KEYS = [
  'canvas',
  'background',
  'planet',
  'layers',
  'shading',
  'accents',
  'palette',
  'export',
] as const

const DEFAULT_OPEN: Record<string, boolean> = {
  canvas: false,
  background: false,
  planet: true,
  layers: true,
  shading: false,
  accents: false,
  palette: true,
  export: false,
}

export default function App() {
  /* ---- boot: parse the patterns the initial document needs ---- */
  const [booted, setBooted] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [parsedById, setParsedById] = useState<Map<string, ParsedPattern>>(new Map())

  const [initial] = useState<PlanetDoc>(() => storage.loadDoc() ?? defaultDoc(randomSeed()))
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
  const svgRef = useRef<SVGSVGElement>(null)

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => setToast(null), error ? 5200 : 2400)
  }, [])

  const update = useCallback(
    (recipe: (d: PlanetDoc) => PlanetDoc, coalesce?: string) => rawUpdate(recipe, { coalesce }),
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

  // Any pattern a layer references but that is not parsed yet.
  useEffect(() => {
    const missing = doc.layers
      .filter((l) => l.kind === 'pattern')
      .map((l) => (l.kind === 'pattern' ? l.patternId : ''))
      .filter((id) => id && !parsedById.has(id))
    if (missing.length === 0) return
    loadPatterns(missing).then(ingest).catch(() => undefined)
  }, [doc.layers, parsedById, ingest])

  /* ---- persistence of UI prefs ---- */
  useEffect(() => {
    const t = setTimeout(
      () =>
        storage.saveUi({
          zoom: ui.zoom,
          fitToStage: ui.fitToStage,
          openSections: SECTION_KEYS.filter((k) => open[k]),
          selectedLayerId: ui.selectedLayerId,
        }),
      300,
    )
    return () => clearTimeout(t)
  }, [ui, open])

  useEffect(() => storage.savePalettes(palettes), [palettes])
  useEffect(() => storage.savePresets(presets), [presets])

  /* ---- remix ---- */

  const available = useMemo(() => [...parsedById.values()], [parsedById])

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
   * `colors` lock still wins, which is what makes it possible to explore
   * geometry against a palette you have settled on.
   */
  const doRemixAll = useCallback(
    (seed?: string) => {
      const next = seed ?? randomSeed()
      const nextPalette = doc.locks.colors
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
    if (doc.locks.colors) return notify('Colors are locked', true)
    const next = pickPalette(palettes, randomSeed(), doc.paletteId)
    rawUpdate((d) => ({ ...d, paletteId: next.id }))
    notify(`Palette: ${next.name}`)
  }, [doc.locks.colors, palettes, doc.paletteId, rawUpdate, notify])

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

  const onApplyPlanetStyle = useCallback(
    (style: PlanetStyle) => {
      rawUpdate((d) => applyPlanetStyle(d, style))
      notify(`Planet style: ${PLANET_STYLE_LABELS[style]}`)
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
      format: 'planetgen.palettes',
      version: 1,
      palettes: custom.length > 0 ? custom : [{ ...palette, builtin: undefined }],
    }
    downloadText(JSON.stringify(payload, null, 2), 'planet-palettes.json', 'application/json')
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

  /* ---- export ---- */

  const exportSvg = useCallback(
    (transparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      downloadText(serializeSvg(el, { transparent }), planetFilename(doc.seed, 'svg'))
      notify('SVG exported')
    },
    [doc.seed, notify],
  )

  const copySvg = useCallback(
    async (transparent: boolean) => {
      const el = svgRef.current
      if (!el) return
      try {
        await navigator.clipboard.writeText(serializeSvg(el, { transparent }))
        notify('SVG markup copied')
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
        const text = serializeSvg(el, { transparent })
        const blob = await rasterizeSvg(
          text,
          doc.canvas.width,
          doc.canvas.height,
          longEdge,
          transparent,
        )
        downloadBlob(blob, planetFilename(doc.seed, 'png', `${longEdge}`))
        notify(`PNG exported at ${longEdge}px long edge`)
      } catch (err) {
        notify(err instanceof Error ? err.message : 'PNG export failed', true)
      } finally {
        setBusy(false)
      }
    },
    [doc.canvas.height, doc.canvas.width, doc.seed, notify],
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
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        if (e.shiftKey) doRemixAll()
        else doRemix()
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        doShuffleColors()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doRemix, doRemixAll, doShuffleColors, undo, redo])

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
      />

      <Stage
        width={doc.canvas.width}
        height={doc.canvas.height}
        zoom={ui.zoom}
        fit={ui.fitToStage}
        onZoomChange={(zoom) => setUi((u) => ({ ...u, zoom }))}
        onFitChange={(fitToStage) => setUi((u) => ({ ...u, fitToStage }))}
      >
        <PlanetSvg
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
        onApplyPlanetStyle={onApplyPlanetStyle}
        onRandomizeSection={onRandomizeSection}
        onRandomizePalette={onRandomizePalette}
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
          onExportSvg: exportSvg,
          onExportPng: exportPng,
          onCopySvg: copySvg,
        }}
      />

      {bootError && <div className="toast toast--error">Pattern library: {bootError}</div>}
      {toast && <div className={`toast${toast.error ? ' toast--error' : ''}`}>{toast.text}</div>}
    </div>
  )
}
