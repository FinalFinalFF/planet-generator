import { useState } from 'react'
import {
  BLEND_MODES,
  MASK_MODES,
  PLANET_STYLES,
  PLANET_STYLE_LABELS,
  type AccentLayer,
  type BlendMode,
  type Layer,
  type LayerMask,
  type LockSection,
  type Palette,
  type PatternLayer,
  type PlanetDoc,
  type PlanetStyle,
  type Preset,
  type ShadingLayer,
  type SliceConfig,
} from '../types'
import { Section } from './Section'
import { Check, ColorRefEditor, Field, NumberField, Segmented, Select, Slider, TextField } from './controls'
import { GradientEditor } from './GradientEditor'
import { ExportPanel, type ExportPanelProps } from './ExportPanel'
import { PalettePanel, type PalettePanelProps } from './PalettePanel'
import type { ParsedPattern } from '../lib/patterns/parse'
import { DEFAULT_LAYER_MASK, detectPlanetStyle, nextId } from '../lib/defaults'

const BLEND_OPTIONS = BLEND_MODES.map((b) => ({ value: b, label: b }))
const MASK_OPTIONS = MASK_MODES.map((m) => ({
  value: m,
  label: m === 'planet' ? 'whole disc' : m === 'lens' ? 'lens' : 'outside lens',
}))

const ASPECTS = [
  { label: '1:1', w: 1600, h: 1600 },
  { label: '16:9', w: 1920, h: 1080 },
  { label: '4:5', w: 1440, h: 1800 },
  { label: '3:2', w: 1800, h: 1200 },
]

export type SidebarProps = {
  doc: PlanetDoc
  palette: Palette
  parsedById: Map<string, ParsedPattern>
  presets: Preset[]
  open: Record<string, boolean>
  onToggleSection: (key: string) => void
  selectedLayerId: string | null
  onSelectLayer: (id: string | null) => void
  update: (recipe: (d: PlanetDoc) => PlanetDoc, coalesce?: string) => void
  onAddPatternLayer: (patternId: string) => void
  onSetLayerPattern: (layerId: string, patternId: string) => void
  palettePanel: Omit<PalettePanelProps, 'palette'>
  exportPanel: ExportPanelProps
  onApplyPlanetStyle: (style: PlanetStyle) => void
  /** Randomize one section, leaving the rest of the composition alone. */
  onRandomizeSection: (section: Exclude<LockSection, 'colors'>) => void
  /** The Palette section's dice picks a different palette. */
  onRandomizePalette: () => void
  /** Built-in library plus anything imported this session. */
  patternOptions: Array<{ id: string; name: string; imported: boolean }>
}

/* ---------- sliced-sphere controls ---------- */

function SliceControls({
  slices,
  onPatch,
}: {
  slices: SliceConfig
  onPatch: (patch: Partial<SliceConfig>, coalesce?: string) => void
}) {
  return (
    <>
      <Segmented
        label="Families"
        value={slices.families === 1 ? '1' : '2'}
        options={[
          { value: '1', label: '1 · bands' },
          { value: '2', label: '2 · lattice' },
        ]}
        onChange={(v) => onPatch({ families: v === '1' ? 1 : 2 })}
      />
      <Slider
        label="Slices per family"
        value={slices.count}
        min={1}
        max={64}
        step={1}
        decimals={0}
        onChange={(count) => onPatch({ count }, 'sl-count')}
      />
      <Slider
        label="Sweep angle"
        value={slices.angle}
        min={0}
        max={360}
        step={1}
        suffix="°"
        onChange={(angle) => onPatch({ angle }, 'sl-angle')}
      />
      <Slider
        label="Fan between families"
        value={slices.fan}
        min={0}
        max={180}
        step={1}
        suffix="°"
        onChange={(fan) => onPatch({ fan }, 'sl-fan')}
      />
      <Slider
        label="Curvature"
        value={slices.curvature}
        min={1.02}
        max={8}
        onChange={(curvature) => onPatch({ curvature }, 'sl-curv')}
      />
      <Slider
        label="Band squash"
        value={slices.arc}
        min={0.05}
        max={3}
        onChange={(arc) => onPatch({ arc }, 'sl-arc')}
      />
      <Slider
        label="Base opacity"
        value={slices.alpha}
        min={0.05}
        max={1}
        onChange={(alpha) => onPatch({ alpha }, 'sl-alpha')}
      />
      <Slider
        label="Lattice strength"
        value={slices.modulation}
        min={0}
        max={1}
        onChange={(modulation) => onPatch({ modulation }, 'sl-mod')}
      />
      <Slider
        label="Second-family ramp offset"
        value={slices.phase}
        min={0}
        max={1}
        onChange={(phase) => onPatch({ phase }, 'sl-phase')}
      />
      <Select
        label="Lattice blend"
        value={slices.blend}
        options={BLEND_OPTIONS}
        onChange={(blend) => onPatch({ blend })}
      />
      <div className="note">
        Keep base opacity near 1 — that is what leaves a crescent of each disc visible.
        Lower it and the bands wash together.
      </div>
    </>
  )
}

/* ---------- pattern layer mask ---------- */

function MaskControls({
  mask,
  onPatch,
}: {
  mask: LayerMask
  onPatch: (patch: Partial<LayerMask>, coalesce?: string) => void
}) {
  return (
    <>
      <Segmented
        label="Paint region"
        value={mask.mode}
        options={MASK_OPTIONS}
        onChange={(mode) => onPatch({ mode })}
      />
      {mask.mode !== 'planet' && (
        <>
          <div className="grid2">
            <Slider
              label="Lens X"
              value={mask.cx}
              min={-1}
              max={1}
              onChange={(cx) => onPatch({ cx }, 'mk-cx')}
            />
            <Slider
              label="Lens Y"
              value={mask.cy}
              min={-1}
              max={1}
              onChange={(cy) => onPatch({ cy }, 'mk-cy')}
            />
          </div>
          <Slider
            label="Lens radius"
            value={mask.radius}
            min={0.05}
            max={2}
            onChange={(radius) => onPatch({ radius }, 'mk-r')}
          />
          <Slider
            label="Edge feather"
            value={mask.feather}
            min={0}
            max={1}
            onChange={(feather) => onPatch({ feather }, 'mk-f')}
          />
        </>
      )}
    </>
  )
}

export function Sidebar(props: SidebarProps) {
  const { doc, palette, open, onToggleSection, update, onRandomizeSection } = props

  const setLock = (section: LockSection, on: boolean) =>
    update((d) => ({ ...d, locks: { ...d.locks, [section]: on } }))

  const lockFor = (section: LockSection) => ({
    section,
    on: doc.locks[section],
    onToggle: (on: boolean) => setLock(section, on),
  })

  // A lock is absolute, so a locked section's dice is dead.
  const diceFor = (section: Exclude<LockSection, 'colors'>, label: string) => ({
    label: `Randomize ${label} only`,
    onRandomize: () => onRandomizeSection(section),
    disabled: doc.locks[section],
  })

  return (
    <aside className="sidebar">
      {/* 01 — Canvas */}
      <Section
        num="01"
        title="Canvas"
        hint={`${doc.canvas.width}×${doc.canvas.height}`}
        open={open.canvas}
        onToggle={() => onToggleSection('canvas')}
      >
        <Segmented
          label="Preset size"
          value={
            ASPECTS.find((a) => a.w === doc.canvas.width && a.h === doc.canvas.height)?.label ??
            'custom'
          }
          options={[...ASPECTS.map((a) => ({ value: a.label, label: a.label })), { value: 'custom', label: 'custom' }]}
          onChange={(label) => {
            const a = ASPECTS.find((x) => x.label === label)
            if (a) update((d) => ({ ...d, canvas: { width: a.w, height: a.h } }))
          }}
        />
        <div className="grid2">
          <NumberField
            label="Width px"
            value={doc.canvas.width}
            min={64}
            max={8192}
            onChange={(width) => update((d) => ({ ...d, canvas: { ...d.canvas, width } }))}
          />
          <NumberField
            label="Height px"
            value={doc.canvas.height}
            min={64}
            max={8192}
            onChange={(height) => update((d) => ({ ...d, canvas: { ...d.canvas, height } }))}
          />
        </div>
        <button
          type="button"
          className="btn btn--block"
          onClick={() =>
            update((d) => ({ ...d, canvas: { width: d.canvas.height, height: d.canvas.width } }))
          }
        >
          Swap orientation
        </button>
      </Section>

      {/* 02 — Background */}
      <Section
        num="02"
        title="Background"
        hint={doc.background.kind}
        open={open.background}
        onToggle={() => onToggleSection('background')}
        lock={lockFor('background')}
        randomize={diceFor('background', 'the background')}
      >
        <Segmented
          label="Fill"
          value={doc.background.kind}
          options={[
            { value: 'solid', label: 'solid' },
            { value: 'gradient', label: 'gradient' },
            { value: 'transparent', label: 'none' },
          ]}
          onChange={(kind) => update((d) => ({ ...d, background: { ...d.background, kind } }))}
        />
        {doc.background.kind === 'solid' && (
          <ColorRefEditor
            name="Background color"
            value={doc.background.color}
            palette={palette}
            onChange={(color) => update((d) => ({ ...d, background: { ...d.background, color } }))}
          />
        )}
        {doc.background.kind === 'gradient' && (
          <GradientEditor
            gradient={doc.background.gradient}
            palette={palette}
            onChange={(gradient, coalesce) =>
              update((d) => ({ ...d, background: { ...d.background, gradient } }), coalesce)
            }
          />
        )}
        <Slider
          label="Vignette"
          value={doc.background.vignette}
          min={0}
          max={1}
          onChange={(vignette) =>
            update((d) => ({ ...d, background: { ...d.background, vignette } }), 'bg-vig')
          }
        />
      </Section>

      {/* 03 — Planet */}
      <Section
        num="03"
        title="Planet"
        hint={doc.planet.mode === 'sliced' ? 'sliced' : doc.planet.gradient.type}
        open={open.planet}
        onToggle={() => onToggleSection('planet')}
        lock={lockFor('planet')}
        randomize={diceFor('planet', 'the planet')}
      >
        {/* Deliberately not called "Planet style": it reaches outside this
            section. It lives here because that is where it is looked for. */}
        <Select
          label="Composition style"
          value={detectPlanetStyle(doc)}
          options={[
            ...PLANET_STYLES.map((s) => ({ value: s, label: PLANET_STYLE_LABELS[s] })),
            { value: 'custom' as const, label: 'Custom' },
          ]}
          onChange={(style) => {
            if (style === 'custom') return
            props.onApplyPlanetStyle(style as PlanetStyle)
          }}
        />
        <div className="note">
          Rewrites planet mode, shading, and layer visibility together. Locked sections are
          left alone.
        </div>
        <Check
          label="Visible"
          checked={doc.planet.visible}
          onChange={(visible) => update((d) => ({ ...d, planet: { ...d.planet, visible } }))}
        />
        <Segmented
          label="Render mode"
          value={doc.planet.mode}
          options={[
            { value: 'disc', label: 'disc' },
            { value: 'sliced', label: 'sliced' },
          ]}
          onChange={(mode) => update((d) => ({ ...d, planet: { ...d.planet, mode } }))}
        />
        <Slider
          label="Radius"
          value={doc.planet.radius}
          min={0.05}
          max={1.4}
          onChange={(radius) => update((d) => ({ ...d, planet: { ...d.planet, radius } }), 'pl-r')}
        />
        <div className="grid2">
          <Slider
            label="Center X"
            value={doc.planet.cx}
            min={-0.5}
            max={1.5}
            onChange={(cx) => update((d) => ({ ...d, planet: { ...d.planet, cx } }), 'pl-cx')}
          />
          <Slider
            label="Center Y"
            value={doc.planet.cy}
            min={-0.5}
            max={1.5}
            onChange={(cy) => update((d) => ({ ...d, planet: { ...d.planet, cy } }), 'pl-cy')}
          />
        </div>
        <hr className="divider" />
        {doc.planet.mode === 'sliced' && (
          <>
            <div className="eyebrow">Slices</div>
            <div className="note">
              Two families of translucent circles march along directions “fan” degrees apart;
              where they cross they compound into flat cells. The ramp below colors them.
            </div>
            <SliceControls
              slices={doc.planet.slices}
              onPatch={(patch, coalesce) =>
                update(
                  (d) => ({ ...d, planet: { ...d.planet, slices: { ...d.planet.slices, ...patch } } }),
                  coalesce,
                )
              }
            />
            <hr className="divider" />
          </>
        )}
        <div className="eyebrow">
          {doc.planet.mode === 'sliced' ? 'Slice color ramp' : 'Fill'}
        </div>
        <GradientEditor
          gradient={doc.planet.gradient}
          palette={palette}
          onChange={(gradient, coalesce) =>
            update((d) => ({ ...d, planet: { ...d.planet, gradient } }), coalesce)
          }
        />
        <hr className="divider" />
        <Check
          label="Outline"
          checked={doc.planet.stroke.enabled}
          onChange={(enabled) =>
            update((d) => ({ ...d, planet: { ...d.planet, stroke: { ...d.planet.stroke, enabled } } }))
          }
        />
        {doc.planet.stroke.enabled && (
          <>
            <Slider
              label="Outline width"
              value={doc.planet.stroke.width}
              min={0.2}
              max={40}
              step={0.2}
              decimals={1}
              onChange={(width) =>
                update(
                  (d) => ({ ...d, planet: { ...d.planet, stroke: { ...d.planet.stroke, width } } }),
                  'pl-sw',
                )
              }
            />
            <Slider
              label="Outline opacity"
              value={doc.planet.stroke.opacity}
              min={0}
              max={1}
              onChange={(opacity) =>
                update(
                  (d) => ({ ...d, planet: { ...d.planet, stroke: { ...d.planet.stroke, opacity } } }),
                  'pl-so',
                )
              }
            />
            <ColorRefEditor
              name="Outline color"
              value={doc.planet.stroke.color}
              palette={palette}
              showAlpha={false}
              onChange={(color) =>
                update((d) => ({ ...d, planet: { ...d.planet, stroke: { ...d.planet.stroke, color } } }))
              }
            />
          </>
        )}
      </Section>

      {/* 04 — Layers */}
      <LayersSection {...props} />

      {/* 05 — Shading */}
      <ShadingSection {...props} />

      {/* 06 — Accents */}
      <AccentsSection {...props} />

      {/* 07 — Palette */}
      <Section
        num="07"
        title="Palette"
        hint={palette.name}
        open={open.palette}
        onToggle={() => onToggleSection('palette')}
        lock={lockFor('colors')}
        randomize={{
          label: 'Switch to a random palette',
          onRandomize: props.onRandomizePalette,
          disabled: doc.locks.colors,
        }}
      >
        <PalettePanel palette={palette} {...props.palettePanel} />
      </Section>

      {/* 08 — Export */}
      <Section
        num="08"
        title="Export"
        open={open.export}
        onToggle={() => onToggleSection('export')}
      >
        <ExportPanel {...props.exportPanel} />
      </Section>
    </aside>
  )
}

/* ---------- 04: the reorderable layer stack ---------- */

const LAYER_KIND_LABEL: Record<Layer['kind'], string> = {
  pattern: 'PAT',
  shading: 'SHD',
  accent: 'ACC',
}

function LayersSection({
  doc,
  palette,
  parsedById,
  open,
  onToggleSection,
  selectedLayerId,
  onSelectLayer,
  update,
  onAddPatternLayer,
  onSetLayerPattern,
  onRandomizeSection,
  patternOptions,
}: SidebarProps) {
  const patch = (id: string, recipe: (l: Layer) => Layer, coalesce?: string) =>
    update(
      (d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? recipe(l) : l)) }),
      coalesce,
    )

  const move = (index: number, delta: number) =>
    update((d) => {
      const to = index + delta
      if (to < 0 || to >= d.layers.length) return d
      const layers = d.layers.slice()
      const [moved] = layers.splice(index, 1)
      layers.splice(to, 0, moved)
      return { ...d, layers }
    })

  const duplicate = (index: number) =>
    update((d) => {
      const src = d.layers[index]
      const copy: Layer = structuredClone(src)
      copy.id = nextId(src.kind === 'pattern' ? 'pl' : src.kind === 'shading' ? 'sh' : 'ac')
      copy.name = `${src.name} copy`
      if (copy.kind === 'accent') {
        copy.rings = copy.rings.map((r) => ({ ...r, id: nextId('r') }))
        copy.satellites = copy.satellites.map((s) => ({ ...s, id: nextId('sa') }))
      }
      const layers = d.layers.slice()
      layers.splice(index + 1, 0, copy)
      return { ...d, layers }
    })

  const remove = (id: string) =>
    update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }))

  return (
    <Section
      num="04"
      title="Layers"
      hint={`${doc.layers.length} · painted bottom → top`}
      open={open.layers}
      onToggle={() => onToggleSection('layers')}
      lock={{
        section: 'patterns',
        on: doc.locks.patterns,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, patterns: on } })),
      }}
      randomize={{
        label: 'Randomize the pattern layers only',
        onRandomize: () => onRandomizeSection('patterns'),
        disabled: doc.locks.patterns,
      }}
    >
      <div className="layers">
        {doc.layers.length === 0 && <div className="note" style={{ padding: 10 }}>No layers yet.</div>}
        {doc.layers.map((layer, i) => {
          const selected = layer.id === selectedLayerId
          return (
            <div key={layer.id} className={`layer${selected ? ' layer--sel' : ''}`}>
              <div className="layer__row">
                <button
                  type="button"
                  className="layer__mini"
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                  onClick={() => patch(layer.id, (l) => ({ ...l, visible: !l.visible }))}
                >
                  {layer.visible ? '●' : '○'}
                </button>
                <span className="layer__kind">{LAYER_KIND_LABEL[layer.kind]}</span>
                <button
                  type="button"
                  className="layer__name"
                  onClick={() => onSelectLayer(selected ? null : layer.id)}
                  title="Edit layer"
                >
                  {layer.name}
                </button>
                <button
                  type="button"
                  className="layer__mini"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Move down the stack"
                  aria-label="Move layer down the stack"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="layer__mini"
                  onClick={() => move(i, 1)}
                  disabled={i === doc.layers.length - 1}
                  title="Move up the stack"
                  aria-label="Move layer up the stack"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="layer__mini"
                  onClick={() => duplicate(i)}
                  title="Duplicate layer"
                  aria-label="Duplicate layer"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="layer__mini"
                  onClick={() => remove(layer.id)}
                  title="Delete layer"
                  aria-label="Delete layer"
                >
                  ✕
                </button>
              </div>

              {selected && (
                <div className="layer__body">
                  <TextField
                    label="Layer name"
                    value={layer.name}
                    mono={false}
                    onCommit={(name) => patch(layer.id, (l) => ({ ...l, name }))}
                  />
                  {layer.kind === 'pattern' && (
                    <PatternLayerEditor
                      layer={layer}
                      palette={palette}
                      parsed={parsedById.get(layer.patternId)}
                      patternOptions={patternOptions}
                      onSetPattern={(patternId) => onSetLayerPattern(layer.id, patternId)}
                      onPatch={(recipe, coalesce) =>
                        patch(layer.id, (l) => recipe(l as PatternLayer), coalesce)
                      }
                    />
                  )}
                  {layer.kind === 'shading' && (
                    <ShadingControls
                      layer={layer}
                      palette={palette}
                      onPatch={(recipe, coalesce) =>
                        patch(layer.id, (l) => recipe(l as ShadingLayer), coalesce)
                      }
                    />
                  )}
                  {layer.kind === 'accent' && (
                    <AccentControls
                      layer={layer}
                      palette={palette}
                      onPatch={(recipe, coalesce) =>
                        patch(layer.id, (l) => recipe(l as AccentLayer), coalesce)
                      }
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AddLayerRow
        doc={doc}
        update={update}
        onAddPatternLayer={onAddPatternLayer}
        patternOptions={patternOptions}
      />
    </Section>
  )
}

function AddLayerRow({
  doc,
  update,
  onAddPatternLayer,
  patternOptions,
}: {
  doc: PlanetDoc
  update: SidebarProps['update']
  onAddPatternLayer: (patternId: string) => void
  patternOptions: SidebarProps['patternOptions']
}) {
  const [patternId, setPatternId] = useState(patternOptions[0]?.id ?? '')
  const patternCount = doc.layers.filter((l) => l.kind === 'pattern').length

  const addShading = () =>
    update((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          kind: 'shading',
          id: nextId('sh'),
          name: 'Sphere shading',
          visible: true,
          shadow: 0.8,
          highlight: 0.4,
          lightAngle: 315,
          lightDistance: 0.5,
          highlightSize: 0.95,
          contactShadow: 0.4,
          shadowColor: { slot: 0 },
          highlightColor: { slot: Math.max(0, d.layers.length) },
          blend: 'normal',
          opacity: 1,
        } satisfies ShadingLayer,
      ],
    }))

  const addAccent = () =>
    update((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          kind: 'accent',
          id: nextId('ac'),
          name: 'Accents',
          visible: true,
          rings: [
            {
              id: nextId('r'),
              radius: 1.25,
              start: 200,
              sweep: 230,
              width: 2.5,
              color: { slot: 3 },
              opacity: 0.6,
              tilt: 0.35,
              rotation: -18,
              dash: 0,
            },
          ],
          satellites: [],
          rim: {
            enabled: true,
            angle: 315,
            width: 0.045,
            spread: 0.55,
            color: { slot: 7 },
            opacity: 0.7,
            blend: 'screen',
          },
        } satisfies AccentLayer,
      ],
    }))

  return (
    <>
      <Field label="Add pattern layer">
        <div className="field__row">
          <select
            className="select"
            value={patternId}
            aria-label="Pattern to add"
            onChange={(e) => setPatternId(e.target.value)}
          >
            {patternOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.imported ? `${p.name} (imported)` : p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => patternId && onAddPatternLayer(patternId)}
          >
            Add
          </button>
        </div>
      </Field>
      <div className="row">
        <button type="button" className="btn" onClick={addShading}>
          + Shading
        </button>
        <button type="button" className="btn" onClick={addAccent}>
          + Accents
        </button>
      </div>

      <hr className="divider" />
      <Check
        label={`Lock pattern layer count (${patternCount})`}
        checked={doc.lockPatternCount}
        onChange={(lockPatternCount) => update((d) => ({ ...d, lockPatternCount }))}
      />
      <div className="note">
        Remix keeps this many pattern layers but still re-rolls what each one is — a way to stay
        at one texture without giving up randomization inside it. The section LOCK freezes the
        layers outright instead.
      </div>
      <div className="note">
        Drop <strong>.svg</strong> files anywhere to add your own patterns — they run through the
        same fill extraction and palette-slot mapping as the built-ins, and become available to
        Remix. They are kept between reloads unless they are too large to store.
      </div>
      <div className="note">
        {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}. Pattern layers are clipped to
        the planet circle; accents are not, so moving one below the patterns puts a ring behind the
        planet.
      </div>
    </>
  )
}

function PatternLayerEditor({
  layer,
  palette,
  parsed,
  patternOptions,
  onSetPattern,
  onPatch,
}: {
  layer: PatternLayer
  palette: Palette
  parsed: ParsedPattern | undefined
  patternOptions: SidebarProps['patternOptions']
  onSetPattern: (patternId: string) => void
  onPatch: (recipe: (l: PatternLayer) => PatternLayer, coalesce?: string) => void
}) {
  return (
    <>
      <Select
        label="Pattern"
        value={layer.patternId}
        options={patternOptions.map((p) => ({
          value: p.id,
          label: p.imported ? `${p.name} (imported)` : p.name,
        }))}
        onChange={onSetPattern}
      />
      <Segmented
        label="Fit"
        value={layer.fit}
        options={[
          { value: 'tile', label: 'tile' },
          { value: 'cover', label: 'cover' },
        ]}
        onChange={(fit) => onPatch((l) => ({ ...l, fit }))}
      />
      <Slider
        label="Scale"
        value={layer.scale}
        min={0.05}
        max={4}
        onChange={(scale) => onPatch((l) => ({ ...l, scale }), `pat-s-${layer.id}`)}
      />
      <Slider
        label="Rotation"
        value={layer.rotation}
        min={-180}
        max={180}
        step={1}
        suffix="°"
        onChange={(rotation) => onPatch((l) => ({ ...l, rotation }), `pat-rot-${layer.id}`)}
      />
      <div className="grid2">
        <Slider
          label="Offset X"
          value={layer.offsetX}
          min={-1}
          max={1}
          onChange={(offsetX) => onPatch((l) => ({ ...l, offsetX }), `pat-ox-${layer.id}`)}
        />
        <Slider
          label="Offset Y"
          value={layer.offsetY}
          min={-1}
          max={1}
          onChange={(offsetY) => onPatch((l) => ({ ...l, offsetY }), `pat-oy-${layer.id}`)}
        />
      </div>
      <Slider
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        onChange={(opacity) => onPatch((l) => ({ ...l, opacity }), `pat-op-${layer.id}`)}
      />
      <Select
        label="Blend mode"
        value={layer.blend}
        options={BLEND_OPTIONS}
        onChange={(blend) => onPatch((l) => ({ ...l, blend }))}
      />
      <hr className="divider" />
      <div className="eyebrow">Overlap region</div>
      <MaskControls
        mask={layer.mask ?? DEFAULT_LAYER_MASK}
        onPatch={(patch, coalesce) =>
          onPatch(
            (l) => ({ ...l, mask: { ...(l.mask ?? DEFAULT_LAYER_MASK), ...patch } }),
            coalesce,
          )
        }
      />
      <hr className="divider" />
      <div className="eyebrow">Pattern colors</div>
      {!parsed && <div className="note">Loading pattern…</div>}
      {parsed?.groups.map((group) => (
        <ColorRefEditor
          key={group.index}
          name={group.label}
          chip={group.sample}
          value={layer.colors[group.index] ?? { slot: 0, alpha: group.isBackground ? 0 : 1 }}
          palette={palette}
          onChange={(color) =>
            onPatch((l) => {
              const colors = l.colors.slice()
              while (colors.length <= group.index) colors.push({ slot: 0, alpha: 1 })
              colors[group.index] = color
              return { ...l, colors }
            })
          }
        />
      ))}
      {parsed && (
        <div className="note">
          {parsed.groups.length} color group{parsed.groups.length === 1 ? '' : 's'} extracted from{' '}
          {parsed.tokenColors.length} source color{parsed.tokenColors.length === 1 ? '' : 's'} · tile{' '}
          {Math.round(parsed.width)}×{Math.round(parsed.height)}
        </div>
      )}
    </>
  )
}

/* ---------- 05: shading ---------- */

function ShadingControls({
  layer,
  palette,
  onPatch,
}: {
  layer: ShadingLayer
  palette: Palette
  onPatch: (recipe: (l: ShadingLayer) => ShadingLayer, coalesce?: string) => void
}) {
  return (
    <>
      <Slider
        label="Light angle"
        value={layer.lightAngle}
        min={0}
        max={360}
        step={1}
        suffix="°"
        onChange={(lightAngle) => onPatch((l) => ({ ...l, lightAngle }), `sh-a-${layer.id}`)}
      />
      <Slider
        label="Terminator shadow"
        value={layer.shadow}
        min={0}
        max={1}
        onChange={(shadow) => onPatch((l) => ({ ...l, shadow }), `sh-s-${layer.id}`)}
      />
      <Slider
        label="Highlight"
        value={layer.highlight}
        min={0}
        max={1}
        onChange={(highlight) => onPatch((l) => ({ ...l, highlight }), `sh-h-${layer.id}`)}
      />
      <Slider
        label="Highlight size"
        value={layer.highlightSize}
        min={0.1}
        max={2}
        onChange={(highlightSize) => onPatch((l) => ({ ...l, highlightSize }), `sh-hs-${layer.id}`)}
      />
      <Slider
        label="Light distance"
        value={layer.lightDistance}
        min={0}
        max={1.2}
        onChange={(lightDistance) =>
          onPatch((l) => ({ ...l, lightDistance }), `sh-ld-${layer.id}`)
        }
      />
      <Slider
        label="Contact shadow"
        value={layer.contactShadow}
        min={0}
        max={1}
        onChange={(contactShadow) => onPatch((l) => ({ ...l, contactShadow }), `sh-cs-${layer.id}`)}
      />
      <Slider
        label="Layer opacity"
        value={layer.opacity}
        min={0}
        max={1}
        onChange={(opacity) => onPatch((l) => ({ ...l, opacity }), `sh-op-${layer.id}`)}
      />
      <Select
        label="Blend mode"
        value={layer.blend}
        options={BLEND_OPTIONS}
        onChange={(blend) => onPatch((l) => ({ ...l, blend }))}
      />
      <ColorRefEditor
        name="Shadow color"
        value={layer.shadowColor}
        palette={palette}
        showAlpha={false}
        onChange={(shadowColor) => onPatch((l) => ({ ...l, shadowColor }))}
      />
      <ColorRefEditor
        name="Highlight color"
        value={layer.highlightColor}
        palette={palette}
        showAlpha={false}
        onChange={(highlightColor) => onPatch((l) => ({ ...l, highlightColor }))}
      />
    </>
  )
}

function ShadingSection({
  doc,
  palette,
  open,
  onToggleSection,
  update,
  onRandomizeSection,
}: SidebarProps) {
  const layer = doc.layers.find((l): l is ShadingLayer => l.kind === 'shading')
  const patch = (recipe: (l: ShadingLayer) => ShadingLayer, coalesce?: string) => {
    if (!layer) return
    update(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? recipe(l as ShadingLayer) : l)),
      }),
      coalesce,
    )
  }

  return (
    <Section
      num="05"
      title="Shading"
      hint={layer ? (layer.visible ? 'on' : 'hidden') : 'none'}
      open={open.shading}
      onToggle={() => onToggleSection('shading')}
      lock={{
        section: 'shading',
        on: doc.locks.shading,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, shading: on } })),
      }}
      randomize={{
        label: 'Randomize the shading only',
        onRandomize: () => onRandomizeSection('shading'),
        disabled: doc.locks.shading,
      }}
    >
      {!layer ? (
        <div className="note">
          No shading layer in the stack. Add one from Layers → + Shading.
        </div>
      ) : (
        <>
          <Check label="Visible" checked={layer.visible} onChange={(visible) => patch((l) => ({ ...l, visible }))} />
          <ShadingControls layer={layer} palette={palette} onPatch={patch} />
        </>
      )}
    </Section>
  )
}

/* ---------- 06: accents ---------- */

function AccentControls({
  layer,
  palette,
  onPatch,
}: {
  layer: AccentLayer
  palette: Palette
  onPatch: (recipe: (l: AccentLayer) => AccentLayer, coalesce?: string) => void
}) {
  const patchRing = (id: string, patch: Partial<AccentLayer['rings'][number]>, coalesce?: string) =>
    onPatch(
      (l) => ({ ...l, rings: l.rings.map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
      coalesce,
    )
  const patchSat = (
    id: string,
    patch: Partial<AccentLayer['satellites'][number]>,
    coalesce?: string,
  ) =>
    onPatch(
      (l) => ({
        ...l,
        satellites: l.satellites.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }),
      coalesce,
    )

  return (
    <>
      <div className="eyebrow">Orbital rings</div>
      {layer.rings.map((ring, i) => (
        <div key={ring.id} className="colorref">
          <div className="colorref__head">
            <span className="colorref__name">Ring {i + 1}</span>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => onPatch((l) => ({ ...l, rings: l.rings.filter((r) => r.id !== ring.id) }))}
            >
              remove
            </button>
          </div>
          <Slider
            label="Radius"
            value={ring.radius}
            min={0.2}
            max={2.5}
            onChange={(radius) => patchRing(ring.id, { radius }, `ring-r-${ring.id}`)}
          />
          <Slider
            label="Tilt"
            value={ring.tilt}
            min={0.02}
            max={1}
            onChange={(tilt) => patchRing(ring.id, { tilt }, `ring-t-${ring.id}`)}
          />
          <Slider
            label="Ellipse rotation"
            value={ring.rotation}
            min={-90}
            max={90}
            step={1}
            suffix="°"
            onChange={(rotation) => patchRing(ring.id, { rotation }, `ring-rot-${ring.id}`)}
          />
          <div className="grid2">
            <Slider
              label="Arc start"
              value={ring.start}
              min={0}
              max={360}
              step={1}
              suffix="°"
              onChange={(start) => patchRing(ring.id, { start }, `ring-st-${ring.id}`)}
            />
            <Slider
              label="Arc sweep"
              value={ring.sweep}
              min={-359}
              max={359}
              step={1}
              suffix="°"
              onChange={(sweep) => patchRing(ring.id, { sweep }, `ring-sw-${ring.id}`)}
            />
          </div>
          <Slider
            label="Stroke width"
            value={ring.width}
            min={0.2}
            max={60}
            step={0.2}
            decimals={1}
            onChange={(width) => patchRing(ring.id, { width }, `ring-w-${ring.id}`)}
          />
          <Slider
            label="Dash"
            value={ring.dash}
            min={0}
            max={60}
            step={0.5}
            decimals={1}
            onChange={(dash) => patchRing(ring.id, { dash }, `ring-d-${ring.id}`)}
          />
          <Slider
            label="Opacity"
            value={ring.opacity}
            min={0}
            max={1}
            onChange={(opacity) => patchRing(ring.id, { opacity }, `ring-o-${ring.id}`)}
          />
          <ColorRefEditor
            name="Ring color"
            value={ring.color}
            palette={palette}
            showAlpha={false}
            onChange={(color) => patchRing(ring.id, { color })}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn--block"
        onClick={() =>
          onPatch((l) => ({
            ...l,
            rings: [
              ...l.rings,
              {
                id: nextId('r'),
                radius: 1.2,
                start: 0,
                sweep: 300,
                width: 2,
                color: { slot: 5 },
                opacity: 0.6,
                tilt: 0.4,
                rotation: 0,
                dash: 0,
              },
            ],
          }))
        }
      >
        + Ring
      </button>

      <hr className="divider" />
      <div className="eyebrow">Satellites</div>
      {layer.satellites.map((sat, i) => (
        <div key={sat.id} className="colorref">
          <div className="colorref__head">
            <span className="colorref__name">Satellite {i + 1}</span>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() =>
                onPatch((l) => ({ ...l, satellites: l.satellites.filter((s) => s.id !== sat.id) }))
              }
            >
              remove
            </button>
          </div>
          <div className="grid2">
            <Slider
              label="Angle"
              value={sat.angle}
              min={0}
              max={360}
              step={1}
              suffix="°"
              onChange={(angle) => patchSat(sat.id, { angle }, `sat-a-${sat.id}`)}
            />
            <Slider
              label="Distance"
              value={sat.distance}
              min={0}
              max={3}
              onChange={(distance) => patchSat(sat.id, { distance }, `sat-d-${sat.id}`)}
            />
          </div>
          <Slider
            label="Size"
            value={sat.size}
            min={0.005}
            max={0.5}
            onChange={(size) => patchSat(sat.id, { size }, `sat-s-${sat.id}`)}
          />
          <Slider
            label="Ring stroke (0 = filled)"
            value={sat.strokeWidth}
            min={0}
            max={20}
            step={0.5}
            decimals={1}
            onChange={(strokeWidth) => patchSat(sat.id, { strokeWidth }, `sat-sw-${sat.id}`)}
          />
          <Slider
            label="Opacity"
            value={sat.opacity}
            min={0}
            max={1}
            onChange={(opacity) => patchSat(sat.id, { opacity }, `sat-o-${sat.id}`)}
          />
          <ColorRefEditor
            name="Satellite color"
            value={sat.color}
            palette={palette}
            showAlpha={false}
            onChange={(color) => patchSat(sat.id, { color })}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn--block"
        onClick={() =>
          onPatch((l) => ({
            ...l,
            satellites: [
              ...l.satellites,
              {
                id: nextId('sa'),
                angle: 45,
                distance: 1.4,
                size: 0.06,
                color: { slot: 6 },
                opacity: 0.9,
                strokeWidth: 0,
              },
            ],
          }))
        }
      >
        + Satellite
      </button>

      <hr className="divider" />
      <div className="eyebrow">Crescent rim light</div>
      <Check
        label="Enabled"
        checked={layer.rim.enabled}
        onChange={(enabled) => onPatch((l) => ({ ...l, rim: { ...l.rim, enabled } }))}
      />
      {layer.rim.enabled && (
        <>
          <Slider
            label="Angle"
            value={layer.rim.angle}
            min={0}
            max={360}
            step={1}
            suffix="°"
            onChange={(angle) => onPatch((l) => ({ ...l, rim: { ...l.rim, angle } }), `rim-a-${layer.id}`)}
          />
          <Slider
            label="Thickness"
            value={layer.rim.width}
            min={0.002}
            max={0.4}
            step={0.002}
            decimals={3}
            onChange={(width) => onPatch((l) => ({ ...l, rim: { ...l.rim, width } }), `rim-w-${layer.id}`)}
          />
          <Slider
            label="Falloff"
            value={layer.rim.spread}
            min={0.05}
            max={2}
            onChange={(spread) => onPatch((l) => ({ ...l, rim: { ...l.rim, spread } }), `rim-s-${layer.id}`)}
          />
          <Slider
            label="Opacity"
            value={layer.rim.opacity}
            min={0}
            max={1}
            onChange={(opacity) => onPatch((l) => ({ ...l, rim: { ...l.rim, opacity } }), `rim-o-${layer.id}`)}
          />
          <Select
            label="Blend mode"
            value={layer.rim.blend}
            options={BLEND_OPTIONS}
            onChange={(blend: BlendMode) => onPatch((l) => ({ ...l, rim: { ...l.rim, blend } }))}
          />
          <ColorRefEditor
            name="Rim color"
            value={layer.rim.color}
            palette={palette}
            showAlpha={false}
            onChange={(color) => onPatch((l) => ({ ...l, rim: { ...l.rim, color } }))}
          />
        </>
      )}
    </>
  )
}

function AccentsSection({
  doc,
  palette,
  open,
  onToggleSection,
  update,
  onRandomizeSection,
}: SidebarProps) {
  const layer = doc.layers.find((l): l is AccentLayer => l.kind === 'accent')
  const patch = (recipe: (l: AccentLayer) => AccentLayer, coalesce?: string) => {
    if (!layer) return
    update(
      (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? recipe(l as AccentLayer) : l)),
      }),
      coalesce,
    )
  }

  return (
    <Section
      num="06"
      title="Accents"
      hint={layer ? `${layer.rings.length}R ${layer.satellites.length}S` : 'none'}
      open={open.accents}
      onToggle={() => onToggleSection('accents')}
      lock={{
        section: 'accents',
        on: doc.locks.accents,
        onToggle: (on) => update((d) => ({ ...d, locks: { ...d.locks, accents: on } })),
      }}
      randomize={{
        label: 'Randomize the accents only',
        onRandomize: () => onRandomizeSection('accents'),
        disabled: doc.locks.accents,
      }}
    >
      {!layer ? (
        <div className="note">No accent layer in the stack. Add one from Layers → + Accents.</div>
      ) : (
        <>
          <Check label="Visible" checked={layer.visible} onChange={(visible) => patch((l) => ({ ...l, visible }))} />
          <AccentControls layer={layer} palette={palette} onPatch={patch} />
        </>
      )}
    </Section>
  )
}
