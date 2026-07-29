import { useState } from 'react'
import { Check, Field, NumberField } from './controls'

export type ExportPanelProps = {
  seed: string
  canvas: { width: number; height: number }
  busy: boolean
  onExportSvg: (transparent: boolean) => void
  onExportPng: (longEdge: number, transparent: boolean) => void
  onCopySvg: (transparent: boolean) => void
}

const SCALES = [1, 2, 4]
const SIZES = [1024, 2048, 4096]

export function ExportPanel({
  seed,
  canvas,
  busy,
  onExportSvg,
  onExportPng,
  onCopySvg,
}: ExportPanelProps) {
  const [transparent, setTransparent] = useState(false)
  const [custom, setCustom] = useState(3000)
  const longEdge = Math.max(canvas.width, canvas.height)

  const dims = (target: number) => {
    const f = target / longEdge
    return `${Math.round(canvas.width * f)}×${Math.round(canvas.height * f)}`
  }

  return (
    <>
      <Check label="Transparent background" checked={transparent} onChange={setTransparent} />
      <div className="note">
        Filenames use the seed: <strong>planet-{seed || 'seed'}.svg</strong>
      </div>

      <hr className="divider" />
      <div className="eyebrow">Vector</div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={() => onExportSvg(transparent)}
      >
        Download SVG
      </button>
      <button
        type="button"
        className="btn btn--block"
        disabled={busy}
        onClick={() => onCopySvg(transparent)}
      >
        Copy SVG markup
      </button>

      <hr className="divider" />
      <div className="eyebrow">Raster — scale</div>
      <div className="grid3">
        {SCALES.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            disabled={busy}
            title={dims(longEdge * s)}
            onClick={() => onExportPng(longEdge * s, transparent)}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="note">
        1× = {dims(longEdge)} · 2× = {dims(longEdge * 2)} · 4× = {dims(longEdge * 4)}
      </div>

      <div className="eyebrow">Raster — long edge</div>
      <div className="grid3">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            disabled={busy}
            title={dims(s)}
            onClick={() => onExportPng(s, transparent)}
          >
            {s}
          </button>
        ))}
      </div>

      <NumberField label="Custom long edge px" value={custom} min={16} max={16384} onChange={setCustom} />
      <button
        type="button"
        className="btn btn--block"
        disabled={busy}
        onClick={() => onExportPng(custom, transparent)}
      >
        Download PNG at {dims(custom)}
      </button>

      <hr className="divider" />
      <Field label="Notes">
        <div className="note">
          The exported SVG is a direct serialization of the live preview with all defs inlined, so it
          opens standalone in a browser. Conic sweeps are built from wedge geometry rather than a CSS
          conic gradient, so they survive export intact.
        </div>
      </Field>
    </>
  )
}
