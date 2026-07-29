import { useState } from 'react'
import { GRADIENT_TYPES, type Gradient, type GradientType, type Palette } from '../types'
import { ColorRefEditor, Segmented, Slider } from './controls'
import { resolveColor } from '../lib/palettes'
import { nextId } from '../lib/defaults'

const TYPE_OPTIONS = GRADIENT_TYPES.map((t) => ({ value: t, label: t }))

export function GradientEditor({
  gradient: g,
  palette,
  onChange,
}: {
  gradient: Gradient
  palette: Palette
  onChange: (next: Gradient, coalesce?: string) => void
}) {
  const [selected, setSelected] = useState(0)
  const stops = g.stops
  const sel = Math.min(selected, Math.max(0, stops.length - 1))
  const stop = stops[sel]

  const setType = (type: GradientType) => onChange({ ...g, type })

  const addStop = () => {
    const sorted = stops.slice().sort((a, b) => a.offset - b.offset)
    const last = sorted[sorted.length - 1]
    const prev = sorted[sorted.length - 2] ?? last
    const offset = last ? Math.min(1, (last.offset + prev.offset) / 2 + 0.05) : 0.5
    const next = [...stops, { id: nextId('s'), offset, color: { ...(last?.color ?? { slot: 0 }) } }]
    onChange({ ...g, stops: next })
    setSelected(next.length - 1)
  }

  const removeStop = () => {
    if (stops.length <= 2) return
    onChange({ ...g, stops: stops.filter((_, i) => i !== sel) })
    setSelected(Math.max(0, sel - 1))
  }

  const patchStop = (patch: Partial<(typeof stops)[number]>, coalesce?: string) => {
    onChange(
      { ...g, stops: stops.map((s, i) => (i === sel ? { ...s, ...patch } : s)) },
      coalesce,
    )
  }

  return (
    <>
      <Segmented label="Gradient" value={g.type} options={TYPE_OPTIONS} onChange={setType} />

      {(g.type === 'linear' || g.type === 'conic') && (
        <Slider
          label={g.type === 'conic' ? 'Sweep start' : 'Angle'}
          value={g.angle}
          min={0}
          max={360}
          step={1}
          suffix="°"
          onChange={(angle) => onChange({ ...g, angle }, 'grad-angle')}
        />
      )}

      {(g.type === 'radial' || g.type === 'conic') && (
        <div className="grid2">
          <Slider
            label="Center X"
            value={g.focusX}
            min={0}
            max={1}
            onChange={(focusX) => onChange({ ...g, focusX }, 'grad-fx')}
          />
          <Slider
            label="Center Y"
            value={g.focusY}
            min={0}
            max={1}
            onChange={(focusY) => onChange({ ...g, focusY }, 'grad-fy')}
          />
        </div>
      )}

      {g.type === 'radial' && (
        <Slider
          label="Spread"
          value={g.radius}
          min={0.05}
          max={2}
          onChange={(radius) => onChange({ ...g, radius }, 'grad-r')}
        />
      )}

      {g.type === 'conic' && (
        <Slider
          label="Sweep segments"
          value={g.segments}
          min={24}
          max={480}
          step={4}
          decimals={0}
          onChange={(segments) => onChange({ ...g, segments }, 'grad-seg')}
        />
      )}

      <div className="field">
        <div className="field__label">
          <span>Stops</span>
          <span>
            {sel + 1} / {stops.length}
          </span>
        </div>
        <div className="stop">
          {stops.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`stop__chip${i === sel ? ' stop__chip--on' : ''}`}
              style={{ background: resolveColor(s.color, palette) }}
              title={`Stop ${i + 1} @ ${Math.round(s.offset * 100)}%`}
              aria-label={`Select stop ${i + 1}`}
              onClick={() => setSelected(i)}
            />
          ))}
          <button type="button" className="btn btn--tiny" onClick={addStop}>
            +
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            onClick={removeStop}
            disabled={stops.length <= 2}
          >
            −
          </button>
        </div>
      </div>

      {stop && (
        <>
          <Slider
            label="Position"
            value={stop.offset}
            min={0}
            max={1}
            onChange={(offset) => patchStop({ offset }, `stop-off-${stop.id}`)}
          />
          <ColorRefEditor
            name={`Stop ${sel + 1} color`}
            value={stop.color}
            palette={palette}
            onChange={(color) => patchStop({ color })}
          />
        </>
      )}
    </>
  )
}
