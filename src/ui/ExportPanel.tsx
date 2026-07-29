import { useState } from 'react'
import { Check, Field, NumberField } from './controls'

export type ExportPanelProps = {
  seed: string
  canvas: { width: number; height: number }
  busy: boolean
  /** Lifted to App so the E shortcut and the batch export use the same value. */
  transparent: boolean
  onTransparentChange: (v: boolean) => void
  /** True when the Background section's fill is set to none. */
  backgroundIsNone: boolean
  expandPatterns: boolean
  onExpandPatternsChange: (v: boolean) => void
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
  transparent,
  onTransparentChange,
  backgroundIsNone,
  expandPatterns,
  onExpandPatternsChange,
  onExportSvg,
  onExportPng,
  onCopySvg,
}: ExportPanelProps) {
  const [custom, setCustom] = useState(3000)
  const longEdge = Math.max(canvas.width, canvas.height)

  const dims = (target: number) => {
    const f = target / longEdge
    return `${Math.round(canvas.width * f)}×${Math.round(canvas.height * f)}`
  }

  return (
    <>
      <Check
        label="Transparent background"
        checked={transparent || backgroundIsNone}
        onChange={onTransparentChange}
      />
      {backgroundIsNone && (
        <div className="note">
          Background fill is set to <strong>none</strong>, so SVG and PNG exports are already
          transparent whether or not this is ticked.
        </div>
      )}
      <div className="note">
        Filenames use the seed: <strong>planet-{seed || 'seed'}.svg</strong>. This toggle also
        applies to the <kbd>E</kbd> shortcut and to batch exports.
      </div>

      <Check
        label="Expand pattern tiles"
        checked={expandPatterns}
        onChange={onExpandPatternsChange}
      />
      <div className="note">
        On, tiled patterns are written out as real geometry. Browsers render an SVG
        <code> &lt;pattern&gt;</code> fill fine, but design-tool importers commonly ignore it —
        Figma drops it, leaving the gradient with no texture. Off gives a much smaller file that
        is browser-only. PNG export never needs this.
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
